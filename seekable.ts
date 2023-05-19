export class SeekableBytesReader {
  private position = 0;
  private data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  read(n: number): Uint8Array {
    if (this.position >= this.data.length) {
      throw new Error("Read position is beyond the length of the data");
    }

    const endPosition = Math.min(this.position + n, this.data.length);
    const readData = this.data.subarray(this.position, endPosition);
    this.position = endPosition;
    return readData;
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
