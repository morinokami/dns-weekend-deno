// utiliies

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const array of arrays) {
    totalLength += array.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.length;
  }

  return result;
}

function uint8ArrayToHex(array: Uint8Array): string {
  return Array.from(array)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function packUnsignedShortsBigEndian(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < values.length; i++) {
    view.setUint16(i * 2, values[i], false);
  }

  return new Uint8Array(buffer);
}

function unpackUnsignedShortsBigEndian(buffer: Uint8Array): number[] {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
  const values: number[] = [];

  for (let i = 0; i < buffer.byteLength; i += 2) {
    values.push(view.getUint16(i, false));
  }

  return values;
}

const TYPE_A = 1;
const TYPE_NS = 2;
const TYPE_TXT = 16;
const CLASS_IN = 1;

class SeekableBufReader {
  private position = 0;
  private data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  read(p: Uint8Array): number | null {
    if (this.position >= this.data.length) {
      return null;
    }

    let i = 0;
    while (i < p.length && this.position < this.data.length) {
      p[i] = this.data[this.position];
      i++;
      this.position++;
    }
    return i;
  }

  readByte(): number | null {
    if (this.position >= this.data.length) {
      return null;
    }
    return this.data[this.position++];
  }

  readFull(p: Uint8Array): Uint8Array | null {
    const bytesRead = this.read(p);
    if (bytesRead === null || bytesRead < p.length) {
      return null;
    }
    return p;
  }

  seek(offset: number) {
    if (offset < 0 || offset > this.data.length) {
      throw new Error("Offset is out of range");
    }
    this.position = offset;
  }

  currentPosition(): number {
    return this.position;
  }
}

// Part 1

class DNSHeader {
  constructor(
    public id: number,
    public flags: number,
    public numQuestions: number = 0,
    public numAnswers: number = 0,
    public numAuthorities: number = 0,
    public numAdditionals: number = 0,
  ) {}
}

class DNSQuestion {
  constructor(
    public name: Uint8Array,
    public type_: number,
    public class_: number,
  ) {}
}

console.assert(
  uint8ArrayToHex(packUnsignedShortsBigEndian([5, 23])) === "00050017",
  `${uint8ArrayToHex(packUnsignedShortsBigEndian([5, 23]))} !== 00050017`,
);

function headerToBytes(header: DNSHeader): Uint8Array {
  const fields: number[] = [
    header.id,
    header.flags,
    header.numQuestions,
    header.numAnswers,
    header.numAuthorities,
    header.numAdditionals,
  ];

  return packUnsignedShortsBigEndian(fields);
}

console.assert(
  uint8ArrayToHex(headerToBytes(new DNSHeader(0x1314, 0, 1, 0, 0, 0))) ===
    "131400000001000000000000",
  `${
    headerToBytes(new DNSHeader(0x1314, 0, 1, 0, 0, 0))
  } !== 131400000001000000000000`,
);

function questionToBytes(question: DNSQuestion): Uint8Array {
  return concatUint8Arrays(
    question.name,
    packUnsignedShortsBigEndian([question.type_, question.class_]),
  );
}

function encodeDnsName(domainName: string): Uint8Array {
  let encoded = new Uint8Array();
  const parts = domainName.split(".");

  for (const part of parts) {
    const partBytes = new TextEncoder().encode(part);
    const lengthByte = new Uint8Array([partBytes.length]);
    encoded = concatUint8Arrays(encoded, lengthByte, partBytes);
  }

  return concatUint8Arrays(encoded, new Uint8Array([0]));
}

console.assert(
  uint8ArrayToHex(encodeDnsName("google.com")) === "06676f6f676c6503636f6d00",
  `${
    uint8ArrayToHex(encodeDnsName("google.com"))
  } !== 06676f6f676c6503636f6d00`,
);

function buildQuery(domainName: string, recordType: number): Uint8Array {
  const name = encodeDnsName(domainName);
  const id = Math.floor(Math.random() * 65536);
  const RECURSION_DESIRED = 1 << 8;
  const header = new DNSHeader(id, RECURSION_DESIRED, 1);
  const question = new DNSQuestion(name, recordType, CLASS_IN);
  return concatUint8Arrays(headerToBytes(header), questionToBytes(question));
}

console.assert(
  // ignore the first 4 bytes because they are random bytes
  uint8ArrayToHex(buildQuery("example.com", TYPE_A)).slice(4) ===
    "01000001000000000000076578616d706c6503636f6d0000010001",
  `${
    uint8ArrayToHex(buildQuery("example.com", TYPE_A)).slice(4)
  } !== 01000001000000000000076578616d706c6503636f6d0000010001`,
);

// Part 2

class DNSRecord {
  constructor(
    public name: Uint8Array,
    public type_: number,
    public class_: number,
    public ttl: number,
    public data: Uint8Array,
  ) {}
}

function parseHeader(reader: SeekableBufReader): DNSHeader {
  const headerBuffer = new Uint8Array(12);
  reader.readFull(headerBuffer);
  const items = unpackUnsignedShortsBigEndian(headerBuffer);
  return new DNSHeader(
    items[0],
    items[1],
    items[2],
    items[3],
    items[4],
    items[5],
  );
}

function decodeNameSimple(reader: SeekableBufReader): Uint8Array {
  const parts: Uint8Array[] = [];
  let length: number;

  while ((length = (reader.readByte()) as number) !== 0) {
    const part = new Uint8Array(length);
    reader.readFull(part);
    parts.push(part);
  }

  const combined = new Uint8Array(
    parts.reduce((acc, part) => acc + part.length + 1, -1),
  );
  let index = 0;
  for (const part of parts) {
    combined.set(part, index);
    index += part.length;
    combined[index++] = 46; // ASCII code for '.'
  }

  return combined;
}

function parseQuestion(reader: SeekableBufReader): DNSQuestion {
  const name = decodeNameSimple(reader);
  const buffer = new Uint8Array(4);
  reader.readFull(buffer);
  const view = new DataView(buffer.buffer);
  const type = view.getUint16(0, false);
  const class_ = view.getUint16(2, false);

  return new DNSQuestion(name, type, class_);
}

function decodeName(reader: SeekableBufReader): Uint8Array {
  const parts: Uint8Array[] = [];
  let length: number;

  while ((length = reader.readByte() as number) !== 0) {
    if (length & 0b1100_0000) {
      const name = decodeCompressedName(length, reader);
      parts.push(name);
      break;
    } else {
      const part = new Uint8Array(length);
      reader.readFull(part);
      parts.push(part);
    }
  }

  const combined = new Uint8Array(
    parts.reduce((acc, part) => acc + part.length + 1, -1),
  );
  let index = 0;
  for (const part of parts) {
    combined.set(part, index);
    index += part.length;
    combined[index++] = 46; // ASCII code for '.'
  }

  return combined;
}

function decodeCompressedName(
  length: number,
  reader: SeekableBufReader,
): Uint8Array {
  const pointerBytes = new Uint8Array(2);
  pointerBytes[0] = length & 0b0011_1111;
  pointerBytes[1] = reader.readByte() as number;
  const pointer = unpackUnsignedShortsBigEndian(pointerBytes)[0];
  const originalPosition = reader.currentPosition();
  reader.seek(pointer);
  const name = decodeName(reader);
  reader.seek(originalPosition);
  return name;
}

function parseRecord(reader: SeekableBufReader): DNSRecord {
  const name = decodeName(reader);

  const buffer = new Uint8Array(10);
  reader.readFull(buffer);
  const view = new DataView(buffer.buffer);
  const type_ = view.getUint16(0, false);
  const class_ = view.getUint16(2, false);
  const ttl = view.getUint32(4, false);
  const dataLen = view.getUint16(8, false);

  const data = new Uint8Array(dataLen);
  reader.readFull(data);

  return new DNSRecord(name, type_, class_, ttl, data);
}

class DNSPacket {
  constructor(
    public header: DNSHeader,
    public questions: DNSQuestion[],
    public answers: DNSRecord[],
    public authorities: DNSRecord[],
    public additionals: DNSRecord[],
  ) {}
}

function parseDNSPacket(data: Uint8Array): DNSPacket {
  const reader = new SeekableBufReader(data);
  const header = parseHeader(reader);
  const questions = [];
  for (let i = 0; i < header.numQuestions; i++) {
    questions.push(parseQuestion(reader));
  }
  const answers = [];
  for (let i = 0; i < header.numAnswers; i++) {
    answers.push(parseRecord(reader));
  }
  const authorities = [];
  for (let i = 0; i < header.numAuthorities; i++) {
    authorities.push(parseRecord(reader));
  }
  const additionals = [];
  for (let i = 0; i < header.numAdditionals; i++) {
    additionals.push(parseRecord(reader));
  }

  return new DNSPacket(header, questions, answers, authorities, additionals);
}

function ipToString(ip: Uint8Array): string {
  return Array.from(ip).join(".");
}

async function lookupDomain(domainName: string): Promise<string> {
  const query = buildQuery(domainName, TYPE_A);
  // create a UDP socket
  const socket = Deno.listenDatagram({
    hostname: "0.0.0.0",
    port: 0,
    transport: "udp",
  });
  // send our query to 8.8.8.8, port 53. Port 53 is the DNS port.
  await socket.send(query, { hostname: "8.8.8.8", port: 53, transport: "udp" });
  // read the response
  const response = await socket.receive();
  // close the socket
  socket.close();
  // parse the response
  const packet = parseDNSPacket(response[0]);
  // return the first IP address
  return ipToString(packet.answers[0].data);
}

console.log(await lookupDomain("www.facebook.com"));

// Part 3

// async function sendQuery(ipAddress: string, domainName: string, recordType: number): Promise<DNSPacket> {
//   const query = buildQuery(domainName, recordType);
//   const socket = Deno.listenDatagram({
//     hostname: "0.0.0.0",
//     port: 0,
//     transport: "udp",
//   });
//   socket.send(query, { hostname: ipAddress, port: 53, transport: "udp" });
//   const [data, _] = await socket.receive();
//   socket.close();
//   return await parseDNSPacket(data);
// }

// const response = await sendQuery("216.239.32.10", "google.com", TYPE_A);
// console.log(response.answers);
