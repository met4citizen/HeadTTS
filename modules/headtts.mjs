/**
* MIT License
*
* Copyright (c) 2025 Mika Suominen
*
* Permission is hereby granted, free of charge, to any person obtaining a copy
* of this software and associated documentation files (the "Software"), to deal
* in the Software without restriction, including without limitation the rights
* to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
* copies of the Software, and to permit persons to whom the Software is
* furnished to do so, subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all
* copies or substantial portions of the Software.
*
* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
* IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
* FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
* AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
* LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
* OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
* SOFTWARE.
*/

import * as utils from "./utils.mjs";

class HeadTTS {

  /**
  * @constructor
  * @param {Object} [settings=null] Global/default options
  * @param {function} [onerror=null] Global Error event callback function
  */
  constructor( settings = null, onerror = null ) {
    this.settings = Object.assign({
      endpoints: ["webgpu", "wasm"],
      audioCtx: null,

      workerModule: null,
      transformersModule: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0/dist/transformers.min.js",

      model: "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped",
      dtypeWebgpu: "fp32", // "fp32" | "fp16" | "q8" | "q4" | "q4f16"
      dtypeWasm: "q4", // "fp32" | "fp16" | "q8" | "q4" | "q4f16"
      styleDim: 256,
      frameRate: 40,
      audioSampleRate: 24000,
      languages: ['en-us'], // Language modules to be preloaded
      dictionaryURL: "../dictionaries",
      voiceURL: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices",
      voices: [], // Voices to be pre-loaded

      deltaStart: -10,
      deltaEnd: 10,
      splitSentences: true,
      splitLength: 500,

      defaultVoice: "af_bella",
      defaultLanguage: "en-us",
      defaultSpeed: 1,
      defaultAudioEncoding: "wav",

      trace: 0
    }, settings || {});

    // Client setup
    this.ttsSetup = {

      // synthesize
      voice: this.settings.defaultVoice,
      language: this.settings.defaultLanguage,
      speed: this.settings.defaultSpeed,
      audioEncoding: this.settings.defaultAudioEncoding

    };

    // Event handlers
    this.onstart = null;
    this.onmessage = null;
    this.onend = null;
    this.onerror = onerror;

    // Create a new audio context, if not set
    if ( !this.settings.audioCtx ) {
      this.settings.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Work items
    this.items = new Map();
    if ( this.settings.splitSentences ) {
      this.dividers = { "! ":1, ". ":1, "? ":1 };
    } else {
      this.dividers = {};
    }
    this.itemWaitingForAudio = null;

    // Work queues
    this.queueIn = [];
    this.queueOut = [];
    this.isProcessingIn = false;
    this.isProcessingOut = false;
    this.messageId = 0;

    // Connection
    this.isConnecting = false;
    this.isConnected = false;
    this.ws = null; // WebSocket connection
    this.ww = null; // Web Worker for in-browser inference
    this.rest = null; // RESTful server
  }

  /**
   * Divide the given text into parts, handling emojis and complex Unicode correctly.
   *
   * @param {string} text Text
   * @param {number} [initialLen=0] Initial length
   * @return {string[]} Array of text parts.
   */
  divideToParts(text, initialLen = 0) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const letters = Array.from(segmenter.segment(text), s => s.segment);
    const textLen = letters.length;

    const parts = [];
    let lastSpace = 0;
    let part = "";

    for (let i = 0; i < textLen; i++) {
      const letter = letters[i];
      const isLast = i === textLen - 1;
      const nextLetter = isLast ? null : letters[i + 1];
      const letterTwo = isLast ? null : letter + nextLetter;
      const isDivider = isLast ? false : this.dividers?.hasOwnProperty(letterTwo);

      if (letter === " ") lastSpace = i;

      part += letter;
      const isMax = (part.length + initialLen) >= this.settings.splitLength;

      if (isMax) {
        if (lastSpace === 0) lastSpace = i;
        parts.push(letters.slice(i - part.length + 1, lastSpace + 1).join(""));
        part = letters.slice(lastSpace + 1, i + 1).join("");
        lastSpace = 0;
        initialLen = 0;
      } else if (isLast || isDivider) {
        parts.push(part);
        part = "";
        lastSpace = 0;
        initialLen = 0;
      }
    }

    return parts;
  }


  /**
  * Emit message to event handlers. If no event handler was called and
  * the message was set throwable, then throw the message.
  *
  * @param {string} title Event title for the log
  * @param {Object} message Message event
  * @param {function[]} handlers Event handlers
  * @param {boolean} [isThrowable=false] If true and no handler called, throw message
  * @param {boolean} [firstOnly=true] If true, only the first handler is called.
  */
  emit( title, message, handlers, isThrowable = false, firstOnly = true ) {
    const isTraceEvents = this.settings.trace & utils.traceMask.events;
    if ( isTraceEvents ) {
      utils.trace( "EMIT: " + title, message );
    }
    let isCalled = false;
    for(let i=0; i<handlers.length; i++) {
      const handler = handlers[i];
      if ( handler && typeof handler === 'function' ) {
        try {
          handler(message);
          isCalled = true;
        } catch(error) {
          console.error("Error calling event handler, error=", error);
        }
        if ( isCalled && firstOnly ) break;
      }
    }
    if ( !isCalled && isThrowable ) throw message;
  }


  /**
  * Connect to WebSocket server or start a web worker for in-browser inference.
  * Tries each server/browser entry in the order they are set. If all fail,
  * emits an "error" event.
  *
  * @param {Object} [settings=false] If true, forces disconnect and re-connects.
  * @param {function} [onerror=null] Callback for Error events overriding event handler
  * @param {function} [onprogress=null] Callback for ProgressEvent events
  */
  async connect( settings = null, onprogress = null, onerror = null ) {
    const isTraceConnection = this.settings.trace & utils.traceMask.connect;
    const isTraceMessages = this.settings.trace & utils.traceMask.messages;

    // If new settings, force re-connect
    if ( settings === null ) {
      if ( this.isConnected || this.isConnecting ) return;
    } else {
      Object.assign(this.settings, settings);
    }
    this.isConnecting = true;

    // Disconnect previous connections if any
    this.isConnected = false;
    if ( this.ws ) {
      if ( isTraceConnection ) {
        utils.trace( "DISCONNECT: WebSocket" );
      }
      this.ws.close();
      this.ws = null;
    }
    if ( this.ww ) {
      if ( isTraceConnection ) {
        utils.trace( "DISCONNECT: Worker" );
      }
      this.ww.terminate();
      this.ww = null;
    }
    if ( this.rest ) {
      if ( isTraceConnection ) {
        utils.trace( "DISCONNECT: REST" );
      }
      this.rest = null;
    }

    // Error events
    const events = [onerror, this.onerror];
    const connectionErrorLog = [];

    for( let i=0; i<this.settings.endpoints.length && !this.isConnected; i++ ) {
      const endpoint = this.settings.endpoints[i].trim();
      const endpointLowerCase = endpoint.toLowerCase();

      if ( endpointLowerCase === "webgpu" || endpointLowerCase === "wasm" ) {

        // Check support for Module Web Workers
        if ( !utils.isModuleWebWorkers() ) {
          if ( isTraceConnection ) {
            utils.trace( "Your browser doesn't support Module Web Workers." );
          }
          connectionErrorLog.push( "Your browser doesn't support Module Web Workers." );
          continue;
        }

        // Check support for WbeGPU, if needed
        if ( endpointLowerCase === "webgpu" && !utils.isWebGPU() ) {
          if ( isTraceConnection ) {
            utils.trace( "Your browser doesn't support WebGPU." );
          }
          connectionErrorLog.push( "Your browser doesn't support WebGPU." );
          continue;
        }

        // Start Web Worker
        try {

          // Wait for Web Worker connection
          await new Promise((resolve, reject) => {

            // Start the TTS web worker
            if ( this.settings.workerModule ) {
              const code = `import "${this.settings.workerModule}";`;
              const blob = new Blob([code], { type: "application/javascript" });
              const url = URL.createObjectURL(blob);
              this.ww = new Worker(url, { type: "module" });
              const origTerminate = this.ww.terminate;
              this.ww.terminate = function () {
                URL.revokeObjectURL(url);
                origTerminate.call(this);
              };
            } else {
              const url = new URL("./worker-tts.mjs", import.meta.url);
              this.ww = new Worker(url, { type: 'module' });
            }

            // Handle progress reports and wait for ready message
            const rejectedTimeout = () => reject('Connection timed out.');
            let timeout = setTimeout(rejectedTimeout, 30000);

            this.ww.onmessage = (ev) => {
              if ( ev.data?.type === 'progress' ) {
                if (timeout) {
                  clearTimeout(timeout);
                  timeout = setTimeout(rejectedTimeout, 10000);
                }
                if ( typeof onprogress === 'function' ) {
                  onprogress( new ProgressEvent('progress', ev.data.data ));
                }
              } else if ( ev.data?.type === 'ready' ) {
                if (timeout) {
                  clearTimeout(timeout);
                  timeout = null;
                }
                resolve();
              }
            }

            this.ww.onerror = (ev) => {
              if (timeout) {
                clearTimeout(timeout);
                timeout = null;
              }
              reject(ev);
            }

            // Setup
            const endpointSetup = {};
            [ "transformersModule", "model", "styleDim", "frameRate",
              "languages", "dictionaryURL", "voiceURL", , "voices",
              "audioSampleRate", "deltaStart", "deltaEnd", "trace" ].forEach( x => {
              if ( this.settings[x] !== undefined ) {
                endpointSetup[x] = this.settings[x];
              }
            });
            endpointSetup.device = endpointLowerCase;
            endpointSetup.dtype = (endpointLowerCase === "webgpu") ? this.settings.dtypeWebgpu : this.settings.dtypeWasm;
            const message = { type: "connect", data: endpointSetup };
            if ( isTraceMessages ) {
              utils.trace( "OUT: HeadTTS -> worker, message=", message );
            }
            this.ww.postMessage( message );

          });

          this.ww.onmessage = (ev) => {
            if ( isTraceMessages ) {
              utils.trace( "IN: worker -> HeadTTS, message=", ev.data);
            }
            this.processData(ev.data);
          }

          this.ww.onerror = (error) => {
            error.preventDefault();
            console.error("HeadTTS: Worker error, error=", error);

            this.emit("error", error, events);

            this.ww.terminate();
            this.ww = null;
            this.isConnected = false;

            this.processIn();
          }

          // Connected
          this.isConnected = true;

        } catch(error) {
          if ( this.ww ) {
            this.ww.terminate();
            this.ww = null;
          }
          if ( isTraceConnection ) {
            utils.trace( "Failed to start Module Web Worker." );
          }
          connectionErrorLog.push( "Failed to start Module Web Worker." );
        }

      } else {

        // Get URL
        let url;
        try {
          url = new URL(endpoint, window.location.href);
        } catch(error) {
          connectionErrorLog.push( "Invalid URL '" + endpoint + "'." );
        }

        if ( url && (url.protocol === 'ws:' || url.protocol === 'wss:' ) ) {

          // Make a connection
          try {

            // Wait for WebSocket connection
            await new Promise((resolve, reject) => {

              // Handle progress reports and wait for ready message
              const rejectedTimeout = () => reject('Connection timed out.');
              let timeout = setTimeout(rejectedTimeout, 5000);

              this.ws = new WebSocket(endpoint);
              this.ws.onopen = () => {
                if ( timeout ) {
                  clearTimeout(timeout);
                }
                resolve();
              }
              this.ws.onerror = (ev) => {
                if ( timeout ) {
                  clearTimeout(timeout);
                }
                reject(ev);
              }
            });

            // Set binary type
            this.ws.binaryType = "arraybuffer";

            // Message handler
            this.ws.onmessage = async (ev) => {
              if ( isTraceMessages ) {
                utils.trace( "IN: WebSocket -> HeadTTS, message=", ev.data);
              }
              this.processData(ev.data);
            }

            // Error handler
            this.ws.onerror = (error) => {
              error.preventDefault();
              console.error("HeadTTS: WebSocket error, error=", error);
            }

            // Connection closed
            this.ws.onclose = (ev) => {

              // Update status
              this.isConnected = false;
              this.ws = null;

              if ( ev.wasClean) {
                if ( isTraceConnection ) {
                  utils.trace( "WebSocket connection closed cleanly, event=", ev);
                }
              } else {
                console.error("HeadTTS: WebSocket connection was closed, event=", ev);
              }

            }

            // Connected
            this.isConnected = true;

          } catch(error) {
            if ( this.ws ) {
              this.ws.close();
              this.ws = null;
            }
            if ( isTraceConnection ) {
              utils.trace('Failed to connect to "' + endpoint + "'." );
            }
            connectionErrorLog.push( 'Failed to connect to "' + endpoint + "'." );
          }

        } else if ( url && (url.protocol === 'http:' || url.protocol === 'https:' ) ) {

          // Check connect with `hello` request
          try {
            const urlHello = new URL(url);
            urlHello.pathname += (urlHello.pathname.endsWith("/") ? "" : "/") + "hello";
            const request = {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              }
            };
            const response = await fetch(urlHello, request);
            const text = await response.text();

            if ( !text.startsWith("HeadTTS") ) {
              throw new Error("Invalid response.");
            }

            // Connected
            this.rest = endpoint;
            this.isConnected = true;

          } catch(error) {
            console.log(error);
            if ( isTraceMessages ) {
              utils.trace( 'The request hello failed on "' + endpoint + '".' );
            }
            connectionErrorLog.push( 'The request hello failed on "' + endpoint + '".' );
          }
        }
      }

    }

    this.isConnecting = false;

    if ( this.isConnected ) {

      // Process queue
      this.processIn(onerror);

    } else {

      // Report error
      let msg = "HeadTTS connection failed: " + connectionErrorLog.join("\n");
      this.emit("error", new Error(msg), events, true );

    }
  }

  /**
  * Clear IN and OUT work queues.
  */
  clear() {

    // Clear item
    const clearItem = (x) => {
      const message = {
        type: "error",
        ref: x.message?.ref || x.message?.id,
        data: {
          error: "Cancelled, clear method called."
        }
      };
      this.emit("message", message, [x.onmessage, this.onmessage]);
      x.deferred.resolve(message);
    }

    // Clear IN queue
    while( this.queueIn.length ) {
      const item = this.queueIn[0];
      this.queueIn.shift();
      clearItem(item);
    }

    // Clear OUT queue
    while( this.queueOut.length ) {
      const item = this.queueOut[0];
      this.queueOut.shift();
      this.items.delete( item.message.ref );
      clearItem(item);
    }

  }


  /**
  * Processes a single "setup" request and adds a new item to the IN work queue.
  *
  * @param {Object} data Setup request message
  * @param {function} [onerror=null] Callback for Error events overriding event handler
  */
  async setup( data, onerror=null ) {
    const isTraceMessages = this.settings.trace & utils.traceMask.messages;
    if ( isTraceMessages ) {
      utils.trace( "SETUP: APP -> HeadTTS, data=",data);
    }

    // Check data item
    const events = [onerror, this.onerror];
    if ( !data ) this.emit("error", new Error("Data not set."), events, true );
    if ( data.hasOwnProperty("voice") ) {
      if ( typeof data.voice !== 'string' ) {
        this.emit("error", new Error("Voice is not a string."), events, true );
        return;
      }
    }
    if ( data.hasOwnProperty("language") ) {
      if ( typeof data.language !== 'string' ) {
        this.emit("error", new Error("Language is not a string."), events, true );
        return;
      }
    }
    if ( data.hasOwnProperty("speed") ) {
      if ( data.speed < 0.25 || data.speed > 4 ) {
        this.emit("error", new Error("Invalid speed, must be between [0.25,4]."), events, true );
        return;
      }
    }
    if ( data.hasOwnProperty("audioEncoding") ) {
      if ( data.audioEncoding !== 'wav' && data.audioEncoding !== 'pcm' ) {
        this.emit("error", new Error("Unsupported audioEncoding, must be 'wav' or 'pcm'."), events, true );
        return;
      }
    }

    // New setup item
    const item = {
      message: {
        type: "setup",
        id: this.messageId++,
        data: data
      },
      status: 0,
      onmessage: null,
      onerror: onerror,
      started: performance.now(),
      deferred: new utils.Deferred()
    };
    this.queueIn.push(item);

    // Process
    this.processIn(onerror);

    // Return the promise of the setup request
    return item.deferred.promise;
  }

  /**
  * Processes a single "synthesize" request, breaks it up into one
  * or more messages/items, and adds each items to the IN work queue.
  *
  * @param {Object} data Synthesize request message
  * @param {function} [onmessage=null] Callback for audio messages overriding event handler
  * @param {function} [onerror=null] Callback for Error events overriding event handler
  * @return {Promise} Promise for the synthesize request that resolves with an array or audio messages.
  */
  async synthesize(data, onmessage=null, onerror=null) {
    if ( this.settings.traceLevel ) {
      utils.trace( this.settings.traceLevel, 3, "SYNTHESIZE: APP -> HeadTTS, data=",data);
    }

    // Check data item
    const events = [onerror, this.onerror];
    if ( !data ) this.emit("error", new Error("Data not set."), events, true );
    if ( !data.hasOwnProperty("input") ) {
      this.emit("error", new Error("Input property not set."), events, true );
      return;
    }
    if ( typeof data.input !== 'string' && !Array.isArray(data.input) ) {
      this.emit("error", new Error("Invalid input type."), events, true );
      return;
    }

    // Setup input items
    let inputItems;
    if ( typeof data.input === 'string' ) {
      inputItems = [ { type: "text", value: data.input } ];
    } else {
      inputItems = data.input.map( x => (typeof x === 'string' ? { type: "text", value: x } : x) );
    }

    // Generated messages
    const messages = [];
    const addMessage = (input) => {
      const message = {
        type: "synthesize",
        id: this.messageId++,
        data: { input }
      };
      if ( data.voice || this.rest ) {
        message.data.voice = data.voice || this.ttsSetup.voice;
      }
      if ( data.language || this.rest ) {
        message.data.language = data.language || this.ttsSetup.language;
      }
      if ( data.speed || this.rest ) {
        message.data.speed = data.speed || this.ttsSetup.speed;
      }
      if ( data.audioEncoding || this.rest ) {
        message.data.audioEncoding = data.audioEncoding || this.ttsSetup.audioEncoding;
      }
      messages.push(message);
    }

    // Process input items
    const len = inputItems.length;
    let outputItems = [];
    let outputTextLen = 0;
    for( let i=0; i<len; i++ ) {
      const item = inputItems[i];

      // Chech input item
      if ( !item.hasOwnProperty("type") ) {
        this.emit("error", new Error("Input item has no type."), events, true );
        return;
      }
      if ( !item.hasOwnProperty("value") ) {
        this.emit("error", new Error("Input item has no value."), events, true );
        return;
      }
      if ( item.hasOwnProperty("subtitles") && typeof item.subtitles !== "string" ) {
        this.emit("error", new Error("Subtitles must be a string, if set for an input item."), events, true );
        return;
      }

      switch( item.type ) {

        case "text":
          const parts = this.divideToParts( item.value, outputTextLen );
          const partsLen = parts.length;
          for( let j=0; j<partsLen-1; j++ ) {
            const part = parts[j];
            outputItems.push(part);
            addMessage(outputItems);
            outputItems = [];
          }
          outputItems.push(parts[ partsLen-1 ]);
          outputTextLen = parts[ partsLen-1 ];
          break;

        case "speech":
        case "phonetic":
        case "characters":
        case "number":
          if ( typeof item.value !== 'string' ) {
            this.emit("error", new Error('Input item of type "' + item.type + '" must have a non-empty string value.'), events, true );
            return;
          }

          if ( (outputTextLen + item.value.length)  >= this.settings.splitLength ) {
            addMessage(outputItems);
            outputItems = [ item ];
            outputTextLen = item.value.length;
          } else {
            outputItems.push(item);
            outputTextLen += item.value.length;
          }
          break;

        case "date":
        case "time":
        case "break":
          if ( Number.isNaN(item.value) || item.value < 0 ) {
            this.emit("error", new Error('Input item of type "' + item.type + '" must have a valid number value.'), events, true );
            return;
          }
          outputItems.push(item);
          outputTextLen += 10;
          break;

        default:
          this.emit("error", new Error('Unknown item type: "' + item.type + '".'), events, true );
          return;
      }

      
    }

    // Add the remaining part
    if ( outputItems.length ) {
      addMessage(outputItems);
    }

    // Add items to queue in order
    const deferredPromises = [];
    for( let i=0; i<messages.length; i++ ) {
      const message = messages[i];
      const item = {
        message: message,
        status: 0,
        onmessage: onmessage,
        onerror: onerror,
        started: performance.now(),
        deferred: new utils.Deferred(),
        metaData: {
          part: i,
          partsTotal: messages.length
        },
        userData: data.userData
      };
      deferredPromises.push( item.deferred.promise );
      this.queueIn.push(item);
    }

    // Process
    this.processIn(onerror);

    // Return the promises of all synthesize messages
    return Promise.all(deferredPromises);
  }

  /**
  * Add a new "custom" message to the IN work queue.
  *
  * @param {Object} data Setup request message
  * @param {function} [onmessage=null] Callback for audio messages overriding event handler
  * @param {function} [onerror=null] Callback for Error events overriding event handler
  */
  async custom( data, onmessage=null, onerror=null ) {
    const isTraceMessages = this.settings.trace & utils.traceMask.messages;
    if ( isTraceMessages ) {
      utils.trace( "CUSTOM: APP -> HeadTTS, data=",data);
    }

    // Check data item
    const events = [onerror, this.onerror];
    if ( !data ) this.emit("error", new Error("Data not set."), events, true );

    // New custom item
    const item = {
      message: {
        type: "custom",
        id: this.messageId++,
        data: data
      },
      status: 0,
      onmessage: onmessage,
      onerror: onerror,
      started: performance.now(),
      deferred: new utils.Deferred()
    };
    this.queueIn.push(item);

    // Process
    this.processIn(onerror);

    // Return the promise of the setup request
    return item.deferred.promise;
  }

  /**
  * Processes the IN work queue (fifo), sends the requests, and adds
  * the items to the OUT work queue to wait for responses.
  *
  * @param {function} [onerror=null] Callback for Error events overriding event handler.
  */
  async processIn( onerror=null ) {
    const isTraceMessages = this.settings.trace & utils.traceMask.messages;
    if ( this.isProcessingIn ) return; // Already processing
    if ( this.isConnecting ) return; // Still connecting
    if ( !this.isConnected ) { // Not connected
      this.connect(onerror);
      return;
    }

    this.isProcessingIn = true;
    while( this.queueIn.length ) {
      const item = this.queueIn[0];
      this.queueIn.shift();

      if ( item.message.type === "setup" ) {

        // Setup
        Object.assign( this.ttsSetup, item.message.data );
        if ( this.ws ) {
          if ( isTraceMessages ) {
            utils.trace( "OUT: HeadTTS -> WebSocket, message=", item.message);
          }
          this.ws.send( JSON.stringify( item.message) );
        }
        item.deferred.resolve();

      } else if ( item.message.type === "custom" ) {

        // Marked ready and add to output queue
        item.status = 2;
        this.items.set( item.message.id, item );
        item.message.ref = item.message.id;
        this.queueOut.push(item);

        // Emit start event, if out queue was empty
        if ( this.queueOut.length === 1 ) {
          this.emit("start", null, [this.onstart]);
        }

        this.processOut();

      } else {

        // Add to output queue to wait for response
        this.items.set( item.message.id, item );
        item.message.ref = item.message.id;
        this.queueOut.push(item);


        // Emit start event, if out queue was empty
        if ( this.queueOut.length === 1 ) {
          this.emit("start", null, [this.onstart]);
        }

        // Send item
        if ( this.ws ) {
          if ( isTraceMessages ) {
            utils.trace( "OUT: HeadTTS -> WebSocket, message=", item.message);
          }
          this.ws.send( JSON.stringify( item.message) );
        } else if ( this.ww ) {
          if ( isTraceMessages ) {
            utils.trace( "OUT: HeadTTS -> worker, message=", item.message);
          }

          // Set default values
          if ( item.message.type === "synthesize" ) {
            item.message.data.voice = this.ttsSetup.voice.slice();
            item.message.data.language = this.ttsSetup.language.slice();
            item.message.data.speed = this.ttsSetup.speed;
            item.message.data.audioEncoding = this.ttsSetup.audioEncoding.slice();
          }

          this.ww.postMessage( item.message );
        } else if ( this.rest ) {

          if ( item.message.type === "synthesize" ) {

            const url = new URL(this.rest);
            url.pathname += (url.pathname.endsWith("/") ? "" : "/") + "synthesize";

            const request = {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(item.message.data)
            };

            if ( isTraceMessages ) {
              utils.trace( "OUT: HeadTTS -> REST, message=", item.message.data);
            }

            fetch(url, request)
              .then(response => {
                if (!response.ok) {
                  throw new Error('Network response was not ok');
                }
                return response.json();
              })
              .then(data => {
                this.processData({
                  type: "audio",
                  ref: item.message.id,
                  data: data
                });
              })
              .catch(error => {
                console.error("HeadTTS: REST error, error=", error);
                this.processData({
                  type: "error",
                  ref: item.message.id,
                  data: {
                    error: "HeadTTS: REST error, message=" + error.message
                  }
                });
              });
          }

        }
      }
    }
    this.isProcessingIn = false;
  }

  /**
  * Processes a single incoming response and updates the status and values
  * of the corresponding item on the OUT work queue.
  *
  * @param {Object|string|ArrayBuffer} data Response message.
  */
  async processData(data) {
    if ( data instanceof ArrayBuffer) {
      if ( this.itemWaitingForAudio ) {
        const item = this.itemWaitingForAudio;
        const itemdata = item.message?.data;
        if ( itemdata ) {
          if ( itemdata.audioEncoding === "wav" ) {
            itemdata.audio = await this.settings.audioCtx.decodeAudioData( data );
          }
        }
        item.status = 2;
      }
    } else {
      let o;
      if ( typeof data === 'string') {
        try {
          o = JSON.parse(data);
        } catch(error) {
          console.log("HeadTTS: Data was not a JSON string.");
        }
      } else {
        o = data;
      }
      if ( typeof o === 'object' ) {
        if ( o.type === "error" ) {
          const item = this.items.get( o.ref );
          if ( item ) {
            item.message = o;
            item.status = 2;
          } else {
            console.log("HeadTTS: Item not found, ref=", o.ref);
          }
        } else if ( o.type === 'audio' ) {
          const item = this.items.get( o.ref );
          if ( item ) {
            item.message = o;
            if ( item.message.data ) {
              const itemdata = item.message.data;
              if ( itemdata.audio ) {
                if ( typeof itemdata.audio === "string" ) {
                  itemdata.audio = utils.b64ToArrayBuffer(itemdata.audio);
                }
                if ( itemdata.audioEncoding === "wav" ) {
                  itemdata.audio = await this.settings.audioCtx.decodeAudioData( itemdata.audio );
                }
                item.status = 2;
              } else {
                this.itemWaitingForAudio = item;
                item.status = 1;
              }
            } else {
              item.status = 2;
            }
          } else {
            console.log("HeadTTS: Item not found, ref=", o.ref);
          }
        } else if ( o.type === "progress" ) {
          console.log("HeadTTS: Progress message.");
        } else if ( o.type === "ready" ) {
          console.log("HeadTTS: Ready message.");
        } else {
          console.error("HeadTTS: Unknown data type.");
        }
      } else {
        console.log("HeadTTS: Unknown data format.");
      }
    }
    this.processOut();
  }

  /**
  * Processes the OUT work queue (fifo), sends the responses to the app by
  * emitting onmessage events.
  */
  async processOut() {
    if ( this.isProcessingOut ) return; // Already processing

    this.isProcessingOut = true;
    while( this.queueOut.length ) {
      const item = this.queueOut[0];
      if ( item.status < 2 ) break; // First item not yet ready
      this.queueOut.shift();
      this.items.delete( item.message.ref );

      const message = item.message;
      message.metaData = item.metaData;
      message.userData = item.userData;
      const type = message.type;

      if ( type === "audio" || type === "custom" ) {
        this.emit("message", message, [item.onmessage, this.onmessage] );
        item.deferred.resolve(message);
      } else if ( type === "error" ) {
        console.error("HeadTTS: Error, item=",item);
        this.emit("error", message, [item.onmessage, this.onmessage] );
        item.deferred.resolve(message);
      }

      // Emit end event
      if ( this.queueOut.length === 0 && this.queueIn.length === 0 ) {
        this.emit("end",null,[this.onend]);
      }
    }
    this.isProcessingOut = false;
  }

}

export { HeadTTS };
