import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg-7";

export function speak(text) {
  const piper = spawn("/usr/local/piper/piper", [
    "--model",
    "models/it_IT-paola-medium.onnx",
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

  // const stream = ffmpeg(piper.stdout)
  //   .inputFormat("s16le")
  //   .inputOptions("-ar", "22050") // Imposta il sample rate di input a 22050 Hz
  //   .audioChannels(1)
  //   .on("codecData", console.log)
  //   .audioCodec("libopus")
  //   .outputFormat("webm")
  //   .on("error", console.error)
  //   .outputOptions("-ar", "48000")
  //   .stream({ end: true });
  // // .output("output.opus")
  // // .run();

  //return stream;
}
