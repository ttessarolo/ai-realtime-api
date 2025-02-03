import { Writable, Readable, Transform } from "node:stream";

export function isStreamEnded(stream) {
  if (stream instanceof Writable) {
    return stream.writableEnded;
  } else if (stream instanceof Readable) {
    return stream.readableEnded;
  } else if (stream instanceof Transform) {
    return stream.readableEnded && stream.writableEnded;
  } else {
    throw new Error("Unknown stream type");
  }
}
