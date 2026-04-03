import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { WebSocketServer } from 'ws';
import * as utils from "./utils.mjs";


/**
* Check if a specific command line option/flag was set.
*
* @param {string} key Option/flag name
* @return {boolean} True, if command line option was set.
*/
function isOptionSet(key) {
  return process.argv.includes('--'+key);
}

/**
* Get the value of the given command line option.
*
* @param {string} key Option/flag name
* @return {string} Value after the option flag or null if not set.
*/
function getOptionValue(key) {
  for( let i=0; i<(process.argv.length-1); i++ ) {
    const arg = process.argv[i];
    if ( arg === '--'+key ) return process.argv[i+1].slice();
  }
  return null;
}


// Default config
const config = {

  server: {
    port: 8882,
    certFile: null,
    keyFile: null,
    websocket: true,
    rest: true,
    connectionTimeout: 20000,
    corsOrigin: "*"
  },

  tts: {
    threads: 1,
    transformersModule: "@huggingface/transformers",
    
    model: "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped",
    dtype: "fp32",
    device: "cpu",
    styleDim: 256,
    frameRate: 40,
    audioSampleRate: 24000,

    languages: ['en-us'],
    dictionaryPath: "./dictionaries",
    voicePath: "./voices",
    voices: ["af_bella"],

    deltaStart: -10,
    deltaEnd: 0,

    defaults: {
      voice: "af_bella",
      language: "en-us",
      speed: 1,
      audioEncoding: "wav"
    }
  },

  trace: 0

};


// Read JSON configuration file
const file = getOptionValue("config") || "./headtts-node.json";
const json = readFileSync(file, 'utf8');
const trace = parseInt(getOptionValue("trace"));
const o = JSON.parse(json);
Object.assign(config.server, o.server);
Object.assign(config.tts, o.tts);
config.trace = Number.isNaN(trace) ? o.trace : trace;

// Trace
const isTraceConnection = config.trace & utils.traceMask.connection;
const isTraceMessages = config.trace & utils.traceMask.messages;
const isTraceEvents = config.trace & utils.traceMask.events;
if ( isTraceConnection ) {
  utils.trace( "CONFIG:", config);
}


// TODO: Check all configuration file parameters and values
if ( config.tts.threads < 1 || config.tts.threads > cpus().length ) {
  console.error("Parameter 'threads' must be between 1 and the number of CPU cores (" + cpus().length + ").");
  process.exit(1);
}

// Item queue
const queue = [];
let threadId = 0;

// WebSocket Connections
const mapWebSocket = new Map();
const mapRest = new Map();
let websocketId = 0;
let restId = 0;

const workers = new Array(config.tts.threads);
const statuses = new Array(config.tts.threads);
for( let i=0; i<config.tts.threads; i++ ) {
  const worker = new Worker('./modules/worker-tts.mjs', { type: "module" });

  workers[i] = worker;
  statuses[i] = 0;

  // Web Worker message handler
  worker.on("message", (message) => {
    if ( isTraceMessages ) {
      utils.trace( "IN: <- Worker", message );
    }

    if ( message.hasOwnProperty("rest") ) {

      // REST response
      const res = mapRest.get(message.rest);
      if ( res ) {
        mapRest.delete(message.rest);
        if ( message.type === "error" ) {
          if ( isTraceMessages ) {
            utils.trace( "OUT: -> REST Client, Error", message.data );
          }
          res.statusCode = 422;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(message.data));
        } else if ( message.type === "audio" ){
          if ( isTraceMessages ) {
            utils.trace( "OUT: -> REST Client, Audio", message.data );
          }
          message.data.audio = Buffer.from(message.data.audio).toString('base64');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(message.data));
        }
      }

    } else if ( message.hasOwnProperty("websocket") ) {

      // WebSocket response
      const ws = mapWebSocket.get(message.websocket);
      if ( ws ) {
        if ( message.type === "error" ) {
          if ( isTraceMessages ) {
            utils.trace( "OUT: -> WebSocket Client, Error", message.data );
          }
          ws.send( JSON.stringify( message ) );
        } else if ( message.type === "audio" ) {
          if ( isTraceMessages ) {
            utils.trace( "OUT: -> WebSocket Client, Audio", message.data );
          }
          const audio = message.data.audio;
          delete message.data.audio;
          ws.send( JSON.stringify( message ) );
          ws.send( audio );
        }
      }

    }
    if ( queue.length ) {
      const o = queue.shift();
      if ( isTraceMessages ) {
        utils.trace( "OUT: -> Worker", o );
      }
      worker.postMessage(o);
    } else {
      statuses[i] = 0;
    }
  });

  // Web Worker error handler
  worker.on("error", (error) => {
    if ( isTraceMessages ) {
      utils.trace( "IN: <- Worker, Error", error );
    }
    console.error(error);
  });

  // Setup Web Worker
  const data = {};
  [ "transformersModule", "model", "dtype", "device", "styleDim", "frameRate",
    "languages", "dictionaryPath", "voicePath", "voices", "audioSampleRate",
    "deltaStart", "deltaEnd", "trace" ].forEach( x => data[x] = config.tts[x] );
  
  // Node.js WebGPU is not thread safe, so we can only have one thread for WebGPU
  if ( data.device === "webgpu" && i > 0 ) {
    data.device = "cpu";
  }

  const message = {
    type: "connect",
    data: data
  };
  worker.postMessage( message );

}

// Server configuration
const port = config.server.port;
const isWebsocket = config.server.websocket;
const isRest = config.server.rest;
const isSecure = config.server.certFile && config.server.keyFile;
let handler;
if ( isRest ) {
  handler = restHandler;
}
let wss;

// Start server
if ( isSecure ) {
  const httpsServer = https.createServer({
    cert: readFileSync(config.server.certFile, 'utf8'),
    key: readFileSync(config.server.keyFile, 'utf8')
  }, handler);
  if ( isWebsocket ) {
    wss = new WebSocketServer({ server: httpsServer });
  }
  httpsServer.listen(port, () => {
    console.info("HeadTTS-Node SECURE server running on port " + port + ".");
  });
} else {
  const httpServer = http.createServer(handler);
  if ( isWebsocket ) {
    wss = new WebSocketServer({ server: httpServer });
  }
  httpServer.listen(port, () => {
    console.info("HeadTTS-Node server running on port " + port + "." );
  });
}

// REST handler
function restHandler(req,res) {

  if ( isTraceMessages ) {
    utils.trace( "IN: <- REST Client", req.method, req.url );
  }

  // Set CORS headers
  if ( config.server.corsOrigin ) {
    res.setHeader('Access-Control-Allow-Origin', config.server.corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  // Handle preflight (OPTIONS) requests
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  // POST messages
  if (req.method === 'POST') {

    // Synthesize
    if ( req.url === '/v1/synthesize') {

      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {

        if ( isTraceMessages ) {
          utils.trace( "IN: Body=", body );
        }

        try {
          const o = JSON.parse(body); // Parse JSON
          // TODO: Check JSON and send 400 if errors

          // Callback mechanism
          const id = ++restId;
          mapRest.set( id, res );

          // Message
          const message = {
            type: "synthesize",
            id: id,
            data: {
              input: (o.input || ""),
              voice: (o.voice || config.tts.defaults.voice),
              language: (o.language || config.tts.defaults.language),
              speed: (o.speed || config.tts.defaults.speed),
              audioEncoding: (o.audioEncoding || config.tts.defaults.audioEncoding)
            },
            rest: id
          }
          queue.push(message);
          for( let i=0; i<config.tts.threads; i++ ) {
            threadId = (threadId + 1) % config.tts.threads;
            if ( statuses[threadId] === 0 ) {
              const o = queue.shift();
              workers[threadId].postMessage(o);
              statuses[threadId] = 1;
              break;
            }
          }
        } catch (err) {
          if ( isTraceMessages ) {
            utils.trace( "OUT: -> REST Client, Error", err.message || "Internal error." );
          }
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: (err.message || "Internal error.")
          }));
        }
      });
    } else if ( req.url === '/v1/hello' ) {
      if ( isTraceMessages ) {
        utils.trace( "OUT: -> REST Client, HELLO" );
      }
      res.statusCode = 200;
      res.end('HeadTTS v0.1.0');
    } else {
      if ( isTraceMessages ) {
        utils.trace( "OUT: REST -> Client Error, Not found." );
      }
      res.statusCode = 404;
      res.end('Not Found');
    }
  } else {
    if ( isTraceMessages ) {
      utils.trace( "OUT: -> REST Client, Error Not found." );
    }
    res.statusCode = 404;
    res.end('Not Found');
  }
}


// WEBSOCKET
if ( wss ) {
  // Set binary type
  wss.binaryType = "arraybuffer";

  // New connections
  wss.on("connection", (ws,req) => {

    if ( isTraceConnection ) {
      utils.trace( "CONNECTION: WebSocket", req.connection );
    }

    // Client setup
    const ttsSetup = Object.assign({}, config.tts.defaults);

    const id = ++websocketId;
    mapWebSocket.set( id, ws );
    console.info("New connection (" + id + ") from " + req.connection.remoteAddress + "." );

    // Timeout
    let timerTimeout = setTimeout(() => {
      ws.close();
    }, config.server.connectionTimeout);

    // WebSocket message handler
    ws.on("message", (data, isBinary) => {
      clearTimeout(timerTimeout);
      timerTimeout = setTimeout(() => {
        ws.close();
      }, config.server.connectionTimeout);

      try {
        if ( isBinary ) {
          console.error('Received binary message.');
        } else {
          const message = JSON.parse( data.toString() );
          if ( isTraceMessages ) {
            utils.trace( "IN: <- WebSocket Client (" + id + ")", message );
          }
          message.websocket = id;
          if ( message.type === "setup" ) {
            // TODO: Check setup values
            Object.assign(ttsSetup, message.data);
          } else {

            // Set values
            if ( message.type === "synthesize" ) {
              message.data.voice = ttsSetup.voice.slice();
              message.data.language = ttsSetup.language.slice();
              message.data.speed = ttsSetup.speed;
              message.data.audioEncoding = ttsSetup.audioEncoding.slice();
            }

            queue.push(message);
            for( let i=0; i<config.tts.threads; i++ ) {
              threadId = (threadId + 1) % config.tts.threads;
              if ( statuses[threadId] === 0 ) {
                const o = queue.shift();
                workers[threadId].postMessage(o);
                statuses[threadId] = 1;
                break;
              }
            }
          }
        }
      } catch(error) {
        console.error('JSON parse failed: ' + error);
      }

    });

    // WebSocket error handler
    ws.on("error", (error) => {
      console.error(error);
      ws.close();
    });

    // WebSocket connection closed
    ws.on("close", (event) => {
      mapWebSocket.delete(id);
      console.info("Connection (" + id + ") closed to " + req.connection.remoteAddress + "." );
    });

  });

  // Server closed, terminate web workers
  wss.on("close", () => {
    for( let i=0; i<config.tts.threads; i++ ) {
      workers[i].terminate();
    }
  });
}
