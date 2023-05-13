// utility functions

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

// Part 1

class DNSHeader {
  constructor(
    public id: number,
    public flags: number,
    public num_questions: number = 0,
    public num_answers: number = 0,
    public num_authorities: number = 0,
    public num_additionals: number = 0,
  ) {}
}

class DNSQuestion {
  constructor(
    public name: Uint8Array,
    public type_: number,
    public class_: number,
  ) {}
}

function packUnsignedShortsBigEndian(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < values.length; i++) {
    view.setUint16(i * 2, values[i], false);
  }

  return new Uint8Array(buffer);
}

console.assert(
  uint8ArrayToHex(packUnsignedShortsBigEndian([5, 23])) === "00050017",
  `${uint8ArrayToHex(packUnsignedShortsBigEndian([5, 23]))} !== 00050017`,
);

function headerToBytes(header: DNSHeader): Uint8Array {
  const fields: number[] = [
    header.id,
    header.flags,
    header.num_questions,
    header.num_answers,
    header.num_authorities,
    header.num_additionals,
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

const TYPE_A = 1;
const CLASS_IN = 1;

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

const query = buildQuery("www.example.com", TYPE_A);
// create a UDP socket
const socket = Deno.listenDatagram({ hostname: "0.0.0.0", port: 0, transport: "udp" });
// send our query to 8.8.8.8, port 53. Port 53 is the DNS port.
await socket.send(query, { hostname: "8.8.8.8", port: 53, transport: "udp" });
// read the response
const response = await socket.receive();
console.log(uint8ArrayToHex(response[0]));
socket.close();
