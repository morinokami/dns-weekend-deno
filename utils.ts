export function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
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

export function uint8ArrayToHex(array: Uint8Array): string {
  return Array.from(array)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function packUnsignedShortsBigEndian(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < values.length; i++) {
    view.setUint16(i * 2, values[i], false);
  }

  return new Uint8Array(buffer);
}

export function unpackUnsignedShortsBigEndian(buffer: Uint8Array): number[] {
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

export function joinUint8ArrayWithDot(array: Uint8Array[]): Uint8Array {
  const totalLength = array.reduce((acc, part) => acc + part.length + 1, -1);
  const result = new Uint8Array(totalLength);
  let index = 0;
  for (const part of array) {
    result.set(part, index);
    index += part.length;
    result[index++] = 46; // ASCII code for '.'
  }

  return result;
}
