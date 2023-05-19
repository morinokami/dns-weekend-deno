import {
  concatUint8Arrays,
  joinUint8ArrayWithDot,
  packUnsignedShortsBigEndian,
  unpackUnsignedShortsBigEndian,
} from "./utils.ts";
import { SeekableBytesReader } from "./seekable.ts";

export const TYPE_A = 1;
export const TYPE_NS = 2;
export const TYPE_TXT = 16;
const CLASS_IN = 1;

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

class DNSRecord {
  constructor(
    public name: Uint8Array,
    public type_: number,
    public class_: number,
    public ttl: number,
    public data: Uint8Array | string,
  ) {}
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

// Part 1

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

function buildQuery(domainName: string, recordType: number): Uint8Array {
  const name = encodeDnsName(domainName);
  const id = Math.floor(Math.random() * 65536);
  const header = new DNSHeader(id, 0, 1);
  const question = new DNSQuestion(name, recordType, CLASS_IN);
  return concatUint8Arrays(headerToBytes(header), questionToBytes(question));
}

// Part 2

function parseHeader(reader: SeekableBytesReader): DNSHeader {
  const items = unpackUnsignedShortsBigEndian(reader.read(12));
  return new DNSHeader(
    items[0],
    items[1],
    items[2],
    items[3],
    items[4],
    items[5],
  );
}

function decodeNameSimple(reader: SeekableBytesReader): Uint8Array {
  const parts: Uint8Array[] = [];
  let length: number;

  while ((length = (reader.read(1)?.at(0)) as number) !== 0) {
    parts.push(reader.read(length));
  }

  return joinUint8ArrayWithDot(parts);
}

function parseQuestion(reader: SeekableBytesReader): DNSQuestion {
  const name = decodeNameSimple(reader);

  const buffer = reader.read(4);
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  const type = view.getUint16(0, false);
  const class_ = view.getUint16(2, false);

  return new DNSQuestion(name, type, class_);
}

function decodeName(reader: SeekableBytesReader): Uint8Array {
  const parts: Uint8Array[] = [];
  let length: number;

  while ((length = reader.read(1)?.at(0) as number) !== 0) {
    if (length & 0b1100_0000) {
      parts.push(decodeCompressedName(length, reader));
      break;
    } else {
      parts.push(reader.read(length));
    }
  }

  return joinUint8ArrayWithDot(parts);
}

function decodeCompressedName(
  length: number,
  reader: SeekableBytesReader,
): Uint8Array {
  const pointerBytes = new Uint8Array(2);
  pointerBytes[0] = length & 0b0011_1111;
  pointerBytes[1] = reader.read(1).at(0) as number;
  const pointer = unpackUnsignedShortsBigEndian(pointerBytes)[0];
  const originalPosition = reader.currentPosition();
  reader.seek(pointer);
  const name = decodeName(reader);
  reader.seek(originalPosition);
  return name;
}

function parseRecord(reader: SeekableBytesReader): DNSRecord {
  const name = decodeName(reader);

  const buffer = reader.read(10);
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );

  const type_ = view.getUint16(0, false);
  const class_ = view.getUint16(2, false);
  const ttl = view.getUint32(4, false);
  const dataLen = view.getUint16(8, false);

  let data: Uint8Array | string;
  if (type_ === TYPE_NS) {
    data = decodeName(reader);
  } else if (type_ === TYPE_A) {
    data = ipToString(reader.read(4));
  } else {
    data = reader.read(dataLen);
  }

  return new DNSRecord(name, type_, class_, ttl, data);
}

function parseDNSPacket(data: Uint8Array): DNSPacket {
  const reader = new SeekableBytesReader(data);
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
  return typeof packet.answers[0].data === "string"
    ? packet.answers[0].data
    : ipToString(packet.answers[0].data);
}

// Part 3

async function sendQuery(
  ipAddress: string,
  domainName: string,
  recordType: number,
): Promise<DNSPacket> {
  const query = buildQuery(domainName, recordType);
  const socket = Deno.listenDatagram({
    hostname: "0.0.0.0",
    port: 0,
    transport: "udp",
  });
  socket.send(query, { hostname: ipAddress, port: 53, transport: "udp" });

  const [data, _] = await socket.receive();
  socket.close();
  return parseDNSPacket(data);
}

function getAnswer(packet: DNSPacket): string {
  for (const answer of packet.answers) {
    if (answer.type_ === TYPE_A) {
      return answer.data as string;
    }
  }
  return "";
}

function getNameserverIp(packet: DNSPacket): string {
  for (const additional of packet.additionals) {
    if (additional.type_ === TYPE_A) {
      return additional.data as string;
    }
  }
  return "";
}

function getNameserver(packet: DNSPacket): string {
  for (const answer of packet.authorities) {
    if (answer.type_ === TYPE_NS) {
      const decoder = new TextDecoder("utf-8");
      return decoder.decode(answer.data as Uint8Array);
    }
  }
  return "";
}

export async function resolve(
  domainName: string,
  recortType: number,
): Promise<string> {
  let nameserver = "198.41.0.4";
  while (true) {
    console.log(`Querying ${nameserver} for ${domainName}`);
    const response = await sendQuery(nameserver, domainName, recortType);
    const ip = getAnswer(response);
    const nsIP = getNameserverIp(response);
    const nsDomain = getNameserver(response);
    if (ip) {
      return ip;
    } else if (nsIP) {
      nameserver = nsIP;
    } else if (nsDomain) {
      nameserver = await resolve(nsDomain, TYPE_A);
    } else {
      throw new Error("Something went wrong");
    }
  }
}
