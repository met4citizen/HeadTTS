# <img src="logo.png" width="100"/>&nbsp; HeadTTS

**HeadTTS** is a free JavaScript text-to-speech (TTS) solution that
provides phoneme-level timestamps and Oculus visemes for lip-sync, in addition
to audio output (WAV/PCM). It uses
[Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped)
neural model and voices, and inference can run entirely in
the browser (WebGPU or WASM), or alternatively
on a Node.js WebSocket/RESTful server (WebGPU or CPU).

- **Pros**: Free. Doesn't require a server in in-browser mode.
WebGPU support. Uses neural voices with a StyleTTS 2 model.
Great for lip-sync use cases and fully compatible with the
[TalkingHead](https://github.com/met4citizen/TalkingHead).
MIT licensed, doesn't use eSpeak or any other GPL-licensed
module.

- **Cons**: Only the latest desktop browsers have
[WebGPU support](https://caniuse.com/webgpu) enabled by default,
the WASM fallback is much slower.
Kokoro is a lightweight model, but it still takes time to
load the first time and consumes a lot of memory.
English is currently the only supported language.

**👉 If you're using a desktop browser, check out the
[IN-BROWSER DEMO](https://met4citizen.github.io/HeadTTS/)!** - If
your browser doesn't have WebGPU support enabled,
the demo app uses WASM as a fallback.

The project uses [websockets/ws](https://github.com/websockets/ws) (MIT License),
[hugginface/transformers.js (with ONNX Runtime)](https://github.com/huggingface/transformers.js/)
(Apache 2.0 License) and
[onnx-community/Kokoro-82M-v1.0-ONNX-timestamped](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped)
(Apache 2.0 License) as runtime dependencies. For information on
language modules and dictionaries, see Appendix B. Using
[jest](https://jestjs.io) for testing.

You can find the list of supported English voices and voice samples
[here](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped#voicessamples).

---

# In-browser Module: `headtts.mjs`

The HeadTTS JavaScript module enables in-browser text-to-speech
using Module Web Workers and WebGPU/WASM inference. Alternatively, it can
connect to and use the HeadTTS Node.js WebSocket/RESTful server.

Create a new `HeadTTS` class instance:

```javascript
import { HeadTTS } from "./modules/headtts.mjs";

const headtts = new HeadTTS({
  endpoints: ["ws://127.0.0.1:8882", "webgpu"], // Endpoints in order of priority
  languages: ['en-us'], // Language modules to pre-load (in-browser)
  voices: ["af_bella", "am_fenrir"] // Voices to pre-load (in-browser)
});
```

Beware that if you import the HeadTTS module from a CDN, you may need to
set the `workerModule` and `dictionaryURL` options explicitly,
as the default relative paths will likely not work:

```javascript
import { HeadTTS } from "https://cdn.jsdelivr.net/npm/@met4citizen/headtts@1.3/+esm";

const headtts = new HeadTTS({
  /* ... */
  workerModule: "https://cdn.jsdelivr.net/npm/@met4citizen/headtts@1.3/modules/worker-tts.mjs",
  dictionaryURL: "https://cdn.jsdelivr.net/npm/@met4citizen/headtts@1.3/dictionaries/"
});
```

<details>
  <summary>CLICK HERE to see all the OPTIONS.</summary>

Option | Description | Default value
--- | --- | ---
`endpoints` | List of WebSocket/RESTful servers or backends `webgpu` or `wasm`, in order of priority. If one fails, the next is used.  | `["webgpu",`<br>` "wasm"]`
`audioCtx` | Audio context for creating audio buffers. If `null`, a new one is created. | `null`
`workerModule` | URL of the HeadTTS Web Worker module. Enables use from a CDN. If set to `null`, the relative path/file `./worker-tts.mjs` is used. | `null`
`transformersModule` | URL of the `transformers.js` module to load. | `"https://cdn.jsdelivr.net/npm/`<br>`@huggingface/transformers@4.0.0`<br>`/dist/transformers.min.js"`
`model` | Kokoro text-to-speech ONNX model (timestamped) used for in-browser inference. | `"onnx-community/`<br>`Kokoro-82M-v1.0-ONNX-timestamped"`
`dtypeWebgpu` | Data type precision for WebGPU inference: `"fp32"` (recommended), `"fp16"`, `"q8"`, `"q4"`, or `"q4f16"`.  | `"fp32"`
`dtypeWasm` | Data type precision for WASM inference: `"fp32"`, `"fp16"`, `"q8"`, `"q4"`, or `"q4f16"`. | `"q4"`
`styleDim` | Style embedding dimension for inference. | `256`
`audioSampleRate` | Audio sample rate in Hz for inference. | `24000`
`frameRate` | Frame rate in FPS for inference. | `40`
`languages` | Language modules to be pre-loaded. | [`"en-us"`]
`dictionaryURL` | URL to language dictionaries. Set to `null` to disable dictionaries. | `"../dictionaries"`
`voiceURL` | URL for loading voices. If the given value is a relative URL, it should be relative to the worker file location. | `"https://huggingface.co/`<br>`onnx-community/`<br>`Kokoro-82M-v1.0-ONNX/`<br>`resolve/main/voices"`
`voices` | Voices to preload (e.g., `["af_bella", "am_fenrir"]`).  | `[]`
`splitSentences` | Whether to split text into sentences. | `true`
`splitLength` | Maximum length (in characters) of each text chunk. | `500`
`deltaStart` | Adjustment (in ms) to viseme start times. | `-10`
`deltaEnd` | Adjustment (in ms) to viseme end times. | `10`
`defaultVoice` | Default voice to use. | `"af_bella"`
`defaultLanguage` | Default language to use. | `"en-us"`
`defaultSpeed` | Speaking speed. Range: 0.25–4. | `1`
`defaultAudioEncoding` | Default audio format: `"wav"` or `"pcm"` (PCM 16-bit LE). | `"wav"`
`trace` | Bitmask for debugging subsystems (`0`=none, `255`=all):<br><ul><li>Bit 0 (1): Connection</li><li>Bit 1 (2): Messages</li><li>Bit 2 (4): Events</li><li>Bit 3 (8): G2P</li><li>Bit 4 (16): Language modules</li></ul> | `0`

Note: Model related options apply only to in-browser inference.
If inference is performed on a server, server-specific
settings will apply instead.

</details>

Connect to the first supported/available endpoint:

```javascript
try {
  await headtts.connect();
} catch(error) {
  console.error(error);
}
```

Make an `onmessage` event handler to handle response messages. In this
example, we use
[TalkingHead](https://github.com/met4citizen/TalkingHead) instance `head`
to play the incoming audio and lip-sync data:

```javascript
// Speak and lipsync
headtts.onmessage = (message) => {
  if ( message.type === "audio" ) {
    try {
      head.speakAudio( message.data, {}, (word) => {
        console.log(word);
      });
    } catch(error) {
      console.error(error);
    }
  } else if ( message.type === "custom" ) {
    console.log("Received custom message, data=", message.data);
  } else if ( message.type === "error" ) {
    console.error("Received error message, error=", message.data.error);
  }
}
```

<details>
  <summary>CLICK HERE to see all the available class EVENTS.</summary>
  
Event handler | Description
--- | ---
`onstart` | Triggered when the first message is added and all message queues were previously empty.
`onmessage` | Handles incoming messages of type `audio`, `error` and `custom`. For details, see the API section.
`onend` | Triggered when all message queues become empty.
`onerror` | Handles system or class-level errors. If this handler is not set, such errors are thrown as exceptions. **Note:** Errors related to TTS conversion are sent to the `onmessage` handler (if defined) as messages of type `error`.

</details>

Setup the voice:

```javascript
headtts.setup({
  voice: "af_bella",
  language: "en-us",
  speed: 1,
  audioEncoding: "wav"
});
```

The HeadTTS client is stateful, so you don't need to call setup again
unless you want to change a setting. For example, if you want to increase
the speed, simply call `headtts.setup({ speed: 1.5 })`.

Synthesize speech using the current voice setup:

```javascript
headtts.synthesize({
  input: "Test sentence."
});
```

The above approach relies on `onmessage` event handler to
receive and handle response messages and it is the recommended
approach for real-time use cases. An alternative approach is to
`await` for all the related audio messages:

```javascript
try {
  const messages = await headtts.synthesize({
    input: "Some long text..."
  });
  console.log(messages); // [{type: 'audio', data: {…}, ref: 1}, {…}, ...]
} catch(error) {
  console.error(error);
}
```

The `input` property can be a string or, alternatively, an array
of strings or inputs items.

<details>
  <summary>CLICK HERE to see the available input ITEM TYPES.</summary>

Type | Description | Example
---|---|---
`text` |  Speak the text in `value`. This is equivalent to giving a pure string input. | <pre>{<br>  type: "text",<br>  value: "This is an example."<br>}</pre>
`speech` |  Speak the text in `value` with corresponding subtitles in `subtitles` (optional). This type allows the spoken words to be different that the subtitles. | <pre>{<br>  type: "speech",<br>  value: "One two three",<br>  subtitles: "123"<br>}</pre>
`phonetic` | Speak the model specific phonetic alphabets in `value` with corresponding `subtitles` (optional). | <pre>{<br>  type: "phonetic",<br>  value: "mˈɜɹʧəndˌIz",<br>  subtitles: "merchandise"<br>}</pre>
`characters` | Speak the `value` character-by-character with corresponding `subtitles` (optional). Supports also numbers that are read digit-by-digit. | <pre>{<br>  type: "characters",<br>  value: "ABC-123-8",<br>  subtitles: "ABC-123-8"<br>}</pre>
`number` | Speak the number in `value` with corresponding `subtitles` (optional). The number should presented as a string. | <pre>{<br>  type: "number",<br>  value: "123.5",<br>  subtitles: "123.5"<br>}</pre>
`date` | Speak the date in `value` with corresponding `subtitles` (optional). The date is presented as milliseconds from epoch. | <pre>{<br>  type: "date",<br>  value: Date.now(),<br>  subtitles: "02/05/2025"<br>}</pre>
`time` | Speak the time in `value` with corresponding `subtitles` (optional). The time is presented as milliseconds from epoch. | <pre>{<br>  type: "time",<br>  value: Date.now(),<br>  subtitles: "6:45 PM"<br>}</pre>
`break` | The length of the break in milliseconds in `value` with corresponding `subtitles` (optional). | <pre>{<br>  type: "break",<br>  value: 2000,<br>  subtitles: "..."<br>}</pre>

An example using an array of input items:

```javascript
{
  type: "synthesize",
  id: 14, // Unique request identifier.
  data: {
    input: [
      "There were ",
      { type: "speech", value: "over two hundred ", subtitles: ">200 " },
      "items of",
      { type: "phonetic", value: "mˈɜɹʧəndˌIz ", subtitles: "merchandise " },
      "on sale."
    ]
  }
}
```

</details>

You can add a custom message to the message queue using
the `custom` method:

```javascript
headtts.custom({
  emoji: "😀"
});
```

Custom messages can be used, for example, to synchronize
speech with animations, emojis, facial expressions, poses,
and/or gestures. You need to implement the custom
functionality yourself within the message handler.

<details>
  <summary>CLICK HERE to see all the class METHODS.</summary>

Method | Description
--- | ---
`connect( settings=null, onprogress=null, onerror=null )` | Connects to the specified set of `endpoints` set in constructor or within the optinal `settings` object. If the `settings` parameter is provided, it forces a reconnection. The `onprogress` callback handles `ProgressEvent` events, while the `onerror` callback handles system-level error events. Returns a promise. **Note:** When connecting to a RESTful server, the method sends a hello message and considers the connection established only if a text response starting with `HeadTTS` is received.
`clear()` | Clears all work queues and resolves all promises.
`setup( data, onerror=null )` | Adds a new setup request to the work queue. See the API section for the supported `data` properties. Returns a promise.
`synthesize( data, onmessage=null, onerror=null )` | Adds a new synthesis request to the work queue. The `data` object supports the `input` and `userData` properties. The `userData` property is returned in the output as `message.userData` unchanged. If event handlers are provided, they override the default handlers. Returns a promise that resolves with a sorted array of related messages of type `"audio"` or `"error"`.
`custom( data, onmessage=null, onerror=null )` | Adds a new custom message to the work queue. If event handlers are provided, they override other handlers. Returns a promise that resolves with the related message of the type `"custom"`.

</details>

---

# NodeJS WebSocket/RESTful Server: `headtts-node.mjs`

Install (requires Node.js v20+):

```bash
git clone https://github.com/met4citizen/HeadTTS
cd HeadTTS
npm install
```

Start the server:

```bash
npm start
```

<details>
  <summary>CLICK HERE to see the COMMAND LINE OPTIONS.</summary>

Option|Description|Default
---|---|---
`--config [file]` | JSON configuration file name. | `./headtts-node.json`
`--trace [0-255]` | Bitmask for debugging subsystems (`0`=none, `255`=all):<br><ul><li>Bit 0 (1): Connection</li><li>Bit 1 (2): Messages</li><li>Bit 2 (4): Events</li><li>Bit 3 (8): G2P</li><li>Bit 4 (16): Language modules</li></ul> | `0`

An example:

```bash
node ./modules/headtts-node.mjs --trace 16
```

</details>

By default, the server uses the `./headtts-node.json` configuration file.

<details>
  <summary>CLICK HERE to see the configurable PROPERTIES.</summary>

Property|Description|Default
---|---|---
`server.port` | The port number the server listens on. | `8882`
`server.certFile` | Path to the certificate file. | `null`
`server.keyFile` | Path to the certificate key file. | `null`
`server.websocket` | Enable the WebSocket server. | `true`
`server.rest` | Enable the RESTful API server. | `true`
`server.connectionTimeout` | Timeout duration for idle connections in milliseconds. | `20000`
`server.corsOrigin` | Value for the `Access-Control-Allow-Origin` header. If `null`, CORS will not be enabled. | `*`
`tts.threads` | Number of text-to-speech worker threads, ranging from 1 to the number of CPU cores. | `1`
`tts.transformersModule` | Name of the transformers.js module to use. | `"@huggingface/transformers"`
`tts.model` | The timestamped Kokoro TTS ONNX model. | `"onnx-community/`<br>`Kokoro-82M-v1.0-ONNX-timestamped"`
`tts.dtype` | The data type precision used for inference. Available options: `"fp32"`, `"fp16"`, `"q8"`, `"q4"`, or `"q4f16"`.  | `"fp32"`
`tts.device` | Computation backend to use: `"webgpu"` or `"cpu"`. NOTE: Node.js WebGPU implementation in Transformers.js is not thread safe, so we can only have one thread for WebGPU. Others will be automatically started as `"cpu"`. | `"webgpu"`
`tts.styleDim` | The embedding dimension for style. | `256`
`tts.audioSampleRate` | Audio sample rate in Hertz (Hz). | `24000`
`tts.frameRate` | Frame rate in frames per second (FPS). | `40`
`tts.languages` | A list of languages to preload. | [`"en-us"`]
`tts.dictionaryPath` | Path to the language modules. If `null`, dictionaries will not be used. | `"./dictionaries"`
`tts.voicePath` | Path to the voice files. | `"./voices"`
`tts.voices` | Array of voices to preload, e.g., `["af_bella","am_fenrir"]`. | `[]`
`tts.deltaStart` | Adjustment (in ms) to viseme start times. | `-10`
`tts.deltaEnd` | Adjustment (in ms) to viseme end times. | `10`
`tts.defaults.voice` | Default voice to use. | `"af_bella"`
`tts.defaults.language` | Default language to use. Supported options: `"en-us"`. | `"en-us"`
`tts.defaults.speed` | Speaking speed. Range: 0.25–4. | `1`
`tts.defaults.audioEncoding` | Default audio encoding format. Supported options are `"wav"` and `"pcm"` (PCM 16bit LE). | `"wav"`
`trace` | Bitmask for debugging subsystems (`0`=none, `255`=all):<br><ul><li>Bit 0 (1): Connection</li><li>Bit 1 (2): Messages</li><li>Bit 2 (4): Events</li><li>Bit 3 (8): G2P</li><li>Bit 4 (16): Language modules</li></ul>  | `0`

</details>

---

# Appendix A: Server API reference

## WebSocket API

Every WebSocket request must have a unique identifier, `id`. The server uses
a Web Worker thread pool, and because work is done in parallel,
the order of responses may vary. Therefore, each response includes
a `ref` property that identifies the original request, allowing
the order to be restored if necessary. The JS client class handles this
automatically.

### Request: `setup`

```javascript
{
  type: "setup",
  id: 12, // Unique request identifier.
  data: {
    voice: "af_bella", // Voice name (optional)
    language: "en-us", // Language (optional)
    speed: 1, // Speed (optional)
    audioEncoding: 'wav' // "wav" or "pcm" (PCM 16bit LE) (optional)
  }
}
```

### Request: `synthesize`

```javascript
{
  type: "synthesize",
  id: 13, // Unique request identifier.
  data: {
    input: "This is an example." // String or array of input items
  }
}
```

The response message for `synthesize` request is either `error` or `audio`.

### Response: `error`

```javascript
{
  type: "error",
  ref: 13, // Original request id
  data: {
    error: "Error loading voice 'af_bella'."
  }
}
```

### Response: `audio`

Returns an audio object metadata that can be passed on the TalkingHead
`speakAudio` method once the audio content itself has been added.

```javascript
{
  type: "audio",
  ref: 13,
  data: {
    words: ['This ', 'is ', 'an ', 'example.'],
    wtimes: [440, 656, 876, 1050],
    wdurations: [236, 240, 194, 1035],
    visemes: ['TH', 'I', 'SS', 'I', 'SS', 'aa', 'nn', 'I', 'kk', 'SS', 'aa', 'PP', 'PP', 'E', 'RR'],
    vtimes: [440, 472, 562, 656, 753, 876, 993, 1050, 1097, 1149, 1200, 1322, 1372, 1423, 1499],
    vdurations: [52, 110, 74, 117, 75, 137, 47, 67, 72, 71, 142, 70, 71, 96, 399],
    phonemes: ['ð', 'ɪ', 's', 'ɪ', 'z', 'æ', 'n', 'ɪ', 'ɡ', 'z', 'æ', 'm', 'p', 'ə', 'l'],  
    audioEncoding: "wav"
  }
}
```

The actual audio content will be delivered after this message as
binary data (see the next response message).

### Response: Binary (ArrayBuffer)

Binary data as an [ArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer)
related to the previous `audio` message. Depending on the set audio encoding,
either a WAV file (`wav`) or a chunk of raw PCM 16bit LE samples (`pcm`).

## RESTful API

RESTful server API is a more simple alternative for WebSocket API.
The REST server is stateless, so voice parameters must be included
for each POST message. If you are using the HeadTTS client class,
it handles this internally.

### POST `/v1/synthesize`

JSON | Description
---|---
`input` | Input to synthesize. String or an array of input items. For a string of text, maximum 500 characters.
`voice` | Voice name.
`language` | Language code.
`speed` | Speed of speech.
`audioEncoding` | Either "wav" for WAV file or "pcm" for raw PCM 16bit LE audio.

OK response:

JSON|Description
---|---
`audio` | Base64 encoded WAV data for `"wav"` or raw PCM 16bit LE samples for `"pcm"` audio encoding.
`words` | Array of words.
`wtimes` | Array of word starting times for `words` in milliseconds.
`wdurations` | Array of word durations for `words` in milliseconds.
`visemes` | Array of Oculus viseme IDs: `'aa'`, `'E'`, `'I'`, `'O'`, `'U'`, `'PP'`, `'SS'`, `'TH'`, `'CH'`, `'FF'`, `'kk'`, `'nn'`, `'RR'`, `'DD'`, `'sil'`.
`vtimes` | Array of viseme starting times for `visemes` in milliseconds.
`vdurations` | Array of viseme durations for `visemes` in milliseconds.
`phonemes` | Array of phonemes corresponding to the array of visemes.
`audioEncoding` | Audio encoding: `"wav"` or `"pcm"`.

Error response:

JSON|Description
---|---
`error` | Error message string

---

# Appendix B: Language modules and dictionaries

### American English, `en-us`

The American English language module is based on the
[CMU Pronunciation Dictionary](http://www.speech.cs.cmu.edu/cgi-bin/cmudict)
from Carnegie Mellon University, containing over 134,000 words and their
pronunciations. The original dataset is provided under a simplified
BSD license, allowing free use for any research or commercial purpose.

In the [Kokoro](https://github.com/hexgrad/kokoro) TTS model,
the American English language data was trained using the
[Misaki](https://github.com/hexgrad/misaki) G2P engine (en).
Therefore, the original [ARPAbet](https://en.wikipedia.org/wiki/ARPABET)
phonemes in the CMU dictionary have been converted to
[IPA](https://en.wikipedia.org/wiki/International_Phonetic_Alphabet)
and then to Misaki-compatible phonemes by applying the following mapping:

- `ɚ` → [ `ɜ`, `ɹ` ], `ˈɝ` → [ `ˈɜ`, `ɹ` ], `ˌɝ` → [ `ˌɜ`, `ɹ` ]
- `tʃ` → [ `ʧ` ], `dʒ` → [ `ʤ` ]
- `eɪ` → [ `A` ], `ˈeɪ` → [ `ˈA` ], `ˌeɪ` → [ `ˌA` ]
- `aɪ` → [ `I` ], `ˈaɪ` → [ `ˈI` ], `ˌaɪ` → [ `ˌI` ]
- `aʊ` → [ `W` ], `ˈaʊ` → [ `ˈW` ], `ˌaʊ` → [ `ˌW` ]
- `ɔɪ` → [ `Y` ], `ˈɔɪ` → [ `ˈY` ], `ˌɔɪ` → [ `ˌY` ]
- `oʊ` → [ `O` ], `ˈoʊ` → [ `ˈO` ], `ˌoʊ` → [ `ˌO` ]
- `əʊ` → [ `Q` ], `ˈəʊ` → [ `ˈQ` ], `ˌəʊ` → [ `ˌQ` ]

The final dictionary is a plain text file with around 125,000 lines (2,8MB).
Lines starting with `;;;` are comments. Each other line represents
one word and its pronunciations. The word and its different possible
pronunciations are separated by a tab character `\t`. An example entry:

```text
MERCHANDISE	mˈɜɹʧəndˌIz
```

Out-of-dictionary (OOD) words are converted using a rule-based algorithm based
on NRL Report 7948, *Automatic Translation of English Text to Phonetics
by Means of Letter-to-Sound Rules* (Elovitz et al., 1976). The report is
available [here](https://apps.dtic.mil/sti/pdfs/ADA021929.pdf).


### Finnish, `fi`

> [!IMPORTANT]  
> As of now, Finnish language is not supported by the Kokoro model.
You can use the `fi` language code with the English voices, but
the pronunciation will sound rather weird.

The phonemization of the Finnish language module is done by
an in-built algorithm. The algorithm doesn't require a pronunciation
dictionary, but it uses a compound word dictionary to get the secondary
stress marks right for compound words.

The dictionary used for compound words is based on
[The Dictionary of Contemporary Finnish](https://en.kotus.fi/dictionaries/#Dictionary-of-Contemporary-Finnish)
maintained by the Institute for the Languages of Finland. The original
dataset contains more than 100,000 entries and is open-sourced
under the CC BY 4.0 license.

The pre-processed compound word dictionary is a plain text file with
around 50,000 entries in 10,000 lines (~350kB). Lines starting
with `;;;` are comments. Each other line represents the first part
of a compound word and the first four letters of all possible
next words, all separated by a tab character `\t`. An example entry:

```text
ALUMIINI	FOLI	KATT	OKSI	PAPE	SEOS	VENE	VUOK
```

---

# Appendix C: Latency

In-browser TTS using WebGPU runs approximately 3x faster than real time
and about 10x faster than WASM. CPU-based inference on a Node.js server
performs surprisingly well. However, increasing the thread pool size
degrades performance. WebGPU inference on a Node.js server is slightly
faster than CPU inference, but it supports only a single dedicated WebGPU
thread. On Metal, the fastest HeadTTS configuration is WebGPU with two
threads where the second thread automatically falls back to CPU execution.

I recommend using 32-bit floating point precision (fp32) for the best
audio quality unless memory consumption becomes a concern.

Unofficial latency results using my own
[latency test app](https://github.com/met4citizen/HeadTTS/blob/main/tests/latency.html):

TTS Engine/Setup |`FIL`<sup>\[1]</sup>|`FBL`<sup>\[2]</sup>|`RTF`<sup>\[3]</sup>
---|---|---|---
HeadTTS, Chrome, WebGPU/fp32 | 8.6s | 852ms | **0.27**
HeadTTS, Edge, WebGPU/fp32 | 8.8s | 858ms | 0.28
HeadTTS, Safari, WebGPU/fp32 | 25.8s | 2437ms | 0.82
HeadTTS, Chrome, WASM/q4 | 45.4s | 4404ms | 1.45
HeadTTS, Edge, WASM/q4 | 45.5s | 4392ms | 1.45
HeadTTS, Safari, WASM/q4 | 45.6s | 4447ms | 1.46
HeadTTS, WebSocket, WebGPU/fp32, 1 thread | 6.6s | 719ms | 0.21
HeadTTS, WebSocket, WebGPU/fp32, 2 threads | 3.8s | 742ms | **0.12**
HeadTTS, WebSocket, CPU/fp32, 1 thread | 6.8s | 712ms | 0.22
HeadTTS, WebSocket, CPU/fp32, 4 threads | 6.0s | 2341ms | 0.20
HeadTTS, REST, WebGPU/fp32, 1 thread | 6.7s | 713ms | 0.21
HeadTTS, REST, WebGPU/fp32, 2 threads | 3.6s | 717ms | **0.11**
HeadTTS, REST, CPU/fp32, 1 thread | 7.0s | 793ms | 0.23
HeadTTS, REST, CPU/fp32, 4 threads | 6.5s | 2638ms | 0.21
ElevenLabs, WebSocket | 4.8s | 977ms | 0.20
ElevenLabs, REST | 11.3s | 1097ms | 0.46
ElevenLabs, REST, Flash_v2_5 | 4.8s | 581ms | 0.22
Microsoft TTS, WebSocket (Speech SDK) | 1.1s | 274ms | 0.04
Google TTS, REST | 0.79s | 67ms | 0.03


<sup>\[1]</sup> *Finish latency*: Total time from sending text input to receiving
the full audio.

<sup>\[2]</sup> *First byte/part/sentence latency*: Time from sending the text input
to receiving the first playable byte/part/sentence of audio.
Note: This measure is not comparable across all models, since some
solutions use streaming, some not.

<sup>\[3]</sup> *Real-time factor* = Time to generate full audio / Duration of the full
audio. If RTF < 1, synthesis is faster than real-time (i.e., good).

**Test setup**: Macbook Air M2 laptop, 8 cores, 16GB memory,
macOS Tahoe 26.0, Metal2 GPU 10 cores, 300/50 Mbit/s internet connection.
The latest Google Chrome, Edge, Safari desktop browsers.

All test cases use WAV or raw PCM 16bit LE format and the "List 1" of the
[Harvard Sentences](https://www.cs.columbia.edu/~hgs/audio/harvard.html):
