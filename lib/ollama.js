import { Transform, pipeline } from "node:stream";
import ollama from "ollama";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const decideOptions = {
  CHAT: "L'utente sta chiedendo informazioni o vuole parlare con il bot",
  STOP: "L'utente vuole interrompere la conversazione con il bot es. dice stop, basta, ecc.",
  OTHER:
    "Non è rilevante, l'utente non sta chiedendo informazioni o vuole parlare con il bot"
};

const decideSchema = zodToJsonSchema(
  z.object({
    intent: z.enum(Object.values(decideOptions)).describe("The user's intent")
  })
);

const dSchema = zodToJsonSchema(
  z.object({
    CHAT: z
      .boolean()
      .describe(
        "L'utente sta chiedendo informazioni o vuole parlare con il bot"
      ),
    STOP: z
      .boolean()
      .describe(
        "L'utente vuole interrompere la conversazione con il bot es. dice stop, basta, ecc."
      ),
    OTHER: z
      .boolean()
      .describe(
        "Non è rilevante, l'utente non sta chiedendo informazioni o vuole parlare con il bot"
      )
  })
);

export function chatStream(content, { signal, onEnd }) {
  signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const client = ollama
      .chat({
        model: "llama3.2:latest", //"phi4:latest",
        keep_alive: "1.5h",
        stream: true,
        messages: [
          {
            role: "user",
            content:
              "Rispondi in maniera sintetica, solo con testo senza elenchi puntati"
          },
          { role: "user", content }
        ]
      })
      .then(async (stream) => {
        const response = [];
        signal?.addEventListener("abort", () => {
          console.log("🛑 Aborting chat!");
          stream.abort();
        });

        const textTransform = new Transform({
          objectMode: true,
          transform(chunk, encoding, callback) {
            const txt = chunk.message.content;
            response.push(txt);
            this.push(txt);
            callback();
          }
        });

        const s = pipeline(stream, textTransform, (err) => {
          if (err) {
            console.log("🛑 Aborted Chat Pipeline!");
          } else onEnd?.(response.join(""));
        });
        resolve(s);
      })
      .catch((err) => {
        console.log("🛑 Aborted Ollama generation!");
      });
  });
}

export async function chat(content, { signal }) {
  signal?.throwIfAborted();

  const response = await ollama.chat({
    model: "phi4:latest",
    keep_alive: "1.5h",
    messages: [
      {
        role: "user",
        content:
          "Rispondi in maniera sintetica, solo con testo senza elenchi puntati"
      },
      { role: "user", content }
    ]
  });

  signal?.throwIfAborted();
  return response.message.content;
}

// export async function decide(content, { signal }) {
//   signal?.throwIfAborted();

//   const response = await ollama.chat({
//     model: "llama3.2:latest", //"phi4:latest", //"llama3.2:latest","deepseek-r1:8b"
//     keep_alive: "1.5h",
//     format: decideSchema,
//     messages: [
//       {
//         role: "system",
//         content:
//           "Indica cosa vuole fare l'utente in base alla sua richiesta di seguito"
//       },
//       { role: "user", content }
//     ],
//     options: {
//       temperature: 0.5 // Make responses more deterministic
//     }
//   });

//   signal?.throwIfAborted();
//   const intent = JSON.parse(response.message.content).intent;
//   const intentCode = Object.keys(decideOptions).find(
//     (key) => decideOptions[key] === intent
//   );
//   return intentCode;
// }

export async function decide(content, { signal }) {
  signal?.throwIfAborted();

  const response = await ollama.chat({
    model: "llama3.2:latest", //"phi4:latest", //"llama3.2:latest","deepseek-r1:8b"
    keep_alive: "1.5h",
    format: dSchema,
    messages: [
      {
        role: "system",
        content:
          "Indica cosa vuole fare l'utente in base alla sua richiesta di seguito"
      },
      { role: "user", content }
    ],
    options: {
      temperature: 0.5 // Make responses more deterministic
    }
  });

  signal?.throwIfAborted();
  const intents = JSON.parse(response.message.content);

  for (const [key, value] of Object.entries(intents)) {
    if (value) {
      return key;
    }
  }
}
