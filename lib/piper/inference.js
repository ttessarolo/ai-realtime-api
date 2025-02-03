import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg-7";

export function speak(text) {
  const piper = spawn("/usr/local/piper/piper", [
    "--model",
    "models/it_IT-riccardo-x_low.onnx",
    //"models/it_IT-paola-medium.onnx",
    "--output-raw" // piper emetterà dati PCM 16bit, mono, 22050 Hz
  ]);

  piper.stdin.write(text);
  piper.stdin.end();

  // Eventuali errori di esecuzione
  piper.on("error", (err) => {
    console.error("Errore eseguendo piper:", err);
  });

  const stream = ffmpeg(piper.stdout)
    .inputFormat("s16le")
    .inputOptions("-ar", "22050")
    .audioChannels(1)
    .audioCodec("pcm_s16le")
    .outputFormat("s16le")
    .audioFrequency(48000)
    .stream({ end: true });

  return stream;
}

export function speakStream(textStream, { signal }) {
  signal?.throwIfAborted();

  signal?.addEventListener("abort", () => {
    console.log("🛑 Aborting speakStream!");
    tx?.end();
  });

  const piper = spawn("/usr/local/piper/piper", [
    "--model",
    "models/it_IT-paola-medium.onnx",
    "--output-raw" // piper emetterà dati PCM 16bit, mono, 22050 Hz
  ]);

  const tx = textStream.pipe(piper.stdin);

  // Eventuali errori di esecuzione
  piper.on("error", (err) => {
    console.error("Errore eseguendo piper:", err);
  });

  const stream = ffmpeg(piper.stdout)
    .inputFormat("s16le")
    .inputOptions("-ar", "22050")
    .audioChannels(1)
    .audioCodec("pcm_s16le")
    .outputFormat("s16le")
    .audioFrequency(48000)
    .stream({ end: true });

  return stream;
}
