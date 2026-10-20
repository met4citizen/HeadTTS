// Import core modules
import fs from "fs";
import readline from "readline";
import path from "path";
import { fileURLToPath } from "url";
import process from 'node:process';

// Setup __dirname in ES module scope
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CMU to IPA phoneme map (with stress)
const cmuToIPA = {
  "AA0": "ɑ",   "AA1": "ˈɑ",   "AA2": "ˌɑ",
  "AE0": "æ",   "AE1": "ˈæ",   "AE2": "ˌæ",
  "AH0": "ə",   "AH1": "ˈʌ",   "AH2": "ˌə",
  "AO0": "ɔ",   "AO1": "ˈɔ",   "AO2": "ˌɔ",
  "AW0": "aʊ",  "AW1": "ˈaʊ",  "AW2": "ˌaʊ",
  "AY0": "aɪ",  "AY1": "ˈaɪ",  "AY2": "ˌaɪ",
  "EH0": "ɛ",   "EH1": "ˈɛ",   "EH2": "ˌɛ",
  "ER0": "ɚ",   "ER1": "ˈɝ",   "ER2": "ˌɝ",
  "EY0": "eɪ",  "EY1": "ˈeɪ",  "EY2": "ˌeɪ",
  "IH0": "ɪ",   "IH1": "ˈɪ",   "IH2": "ˌɪ",
  "IY0": "i",   "IY1": "ˈi",   "IY2": "ˌi",
  "OW0": "oʊ",  "OW1": "ˈoʊ",  "OW2": "ˌoʊ",
  "OY0": "ɔɪ",  "OY1": "ˈɔɪ",  "OY2": "ˌɔɪ",
  "UH0": "ʊ",   "UH1": "ˈʊ",   "UH2": "ˌʊ",
  "UW0": "u",   "UW1": "ˈu",   "UW2": "ˌu",
  "B": "b", "CH": "tʃ", "D": "d", "DH": "ð", "F": "f", "G": "ɡ",
  "HH": "h", "JH": "dʒ", "K": "k", "L": "l", "M": "m", "N": "n",
  "NG": "ŋ", "P": "p", "R": "ɹ", "S": "s", "SH": "ʃ", "T": "t",
  "TH": "θ", "V": "v", "W": "w", "Y": "j", "Z": "z", "ZH": "ʒ"
};

const IPAToMisaki = {
  "ɚ": ["ɜ","ɹ"], "ˈɝ": ["ˈɜ","ɹ"], "ˌɝ": ["ˌɜ","ɹ"],
  "tʃ": ["ʧ"], "dʒ": ["ʤ"],
  "eɪ": ["A"], "ˈeɪ": ["ˈA"], "ˌeɪ": ["ˌA"],
  "aɪ": ["I"], "ˈaɪ": ["ˈI"], "ˌaɪ": ["ˌI"],
  "aʊ": ["W"], "ˈaʊ": ["ˈW"], "ˌaʊ": ["ˌW"],
  "ɔɪ": ["Y"], "ˈɔɪ": ["ˈY"], "ˌɔɪ": ["ˌY"],
  "oʊ": ["O"], "ˈoʊ": ["ˈO"], "ˌoʊ": ["ˌO"],
  "əʊ": ["Q"], "ˈəʊ": ["ˈQ"], "ˈəʊ": ["ˌQ"]
};

const reducedPronunciations = {
  I: ["AY1"]
  
  // NOTE: Skipping reduced vowels, because Kokoro was not taught with them

  /* A: ["AH0"], ABOUT: ["AH0", "B", "AW1", "T"], AN: ["AH0", "N"],
  AND: ["AH0", "N"], ARE: ["ER0"], AS: ["AH0", "Z"], AT: ["AH0", "T"],
  BE: ["B", "IY0"], BEEN: ["B", "IH0", "N"], CAN: ["K", "AH0", "N"],
  COULD: ["K", "UH0", "D"], DID: ["D", "IH0", "D"], DO: ["D", "OW0"],
  DOES: ["D", "AH0", "Z"], FOR: ["F", "ER0"], FROM: ["F", "R", "AH0", "M"],
  HAD: ["HH", "AH0", "D"], HAS: ["HH", "AH0", "Z"], HAVE: ["HH", "AH0", "V"],
  HE: ["HH", "IY0"], HER: ["HH", "ER0"], HIM: ["HH", "IH0", "M"],
  HIS: ["HH", "IH0", "Z"], I: ["AY0"], IF: ["IH0", "F"], IN: ["IH0", "N"],
  IS: ["IH0", "Z"], IT: ["IH0", "T"], ME: ["M", "IY0"],
  MIGHT: ["M", "AY0", "T"], MUST: ["M", "AH0", "S", "T"],
  NOT: ["N", "AH0", "T"], OF: ["AH0", "V"], ON: ["AH0", "N"], OR: ["ER0"],
  OUR: ["AW0", "ER0"], OUT: ["AW0", "T"], SHALL: ["SH", "AH0", "L"],
  SHOULD: ["SH", "UH0", "D"], SO: ["S", "OW0"], THAN: ["DH", "AH0", "N"],
  THAT: ["DH", "AH0", "T"], THE: ["DH", "AH0"], THEM: ["DH", "AH0", "M"],
  THERE: ["DH", "EH1", "R"], THEY: ["DH", "EY0"], THIS: ["DH", "IH0", "S"],
  TO: ["T", "AH0"], UP: ["AH0", "P"], US: ["AH0", "S"], WAS: ["W", "AH0", "Z"],
  WE: ["W", "IY0"], WERE: ["W", "ER0"], WHAT: ["W", "AH0", "T"],
  WHO: ["HH", "UW0"], WILL: ["W", "IH0", "L"], WOULD: ["W", "UH0", "D"],
  YOU: ["Y", "UW0"], YOUR: ["Y", "ER0"], "I'M": ["AY0", "M"],
  "YOU'RE": ["Y", "ER0"], "HE'S": ["HH", "IY0", "Z"], "SHE'S": ["SH", "IY0", "Z"],
  "IT'S": ["IH0", "T", "S"], "WE'RE": ["W", "ER0"], "THEY'RE": ["DH", "ER0"],
  "I'VE": ["AY0", "V"], "YOU'VE": ["Y", "UW0", "V"], "WE'VE": ["W", "IY0", "V"],
  "THEY'VE": ["DH", "EY0", "V"], "I'D": ["AY0", "D"], "YOU'D": ["Y", "UW0", "D"],
  "HE'D": ["HH", "IY0", "D"], "SHE'D": ["SH", "IY0", "D"],
  "WE'D": ["W", "IY0", "D"], "THEY'D": ["DH", "EY0", "D"],
  "I'LL": ["AY0", "L"], "YOU'LL": ["Y", "UW0", "L"], "HE'LL": ["HH", "IY0", "L"],
  "SHE'LL": ["SH", "IY0", "L"], "WE'LL": ["W", "IY0", "L"],
  "THEY'LL": ["DH", "EY0", "L"], "DON'T": ["D", "OW0", "N", "T"],
  "DOESN'T": ["D", "AH0", "Z", "N", "T"], "DIDN'T": ["D", "IH0", "D", "N", "T"],
  "HASN'T": ["HH", "AE0", "Z", "N", "T"], "HAVEN'T": ["HH", "AE0", "V", "N", "T"],
  "HADN'T": ["HH", "AE0", "D", "N", "T"], "ISN'T": ["IH0", "Z", "N", "T"],
  "AREN'T": ["AA0", "R", "N", "T"], "WASN'T": ["W", "AH0", "Z", "N", "T"],
  "WEREN'T": ["W", "ER0", "N", "T"], "WOULDN'T": ["W", "UH0", "D", "N", "T"],
  "SHOULDN'T": ["SH", "UH0", "D", "N", "T"], "COULDN'T": ["K", "UH0", "D", "N", "T"],
  "MUSTN'T": ["M", "AH0", "S", "N", "T"], "LET'S": ["L", "EH0", "T", "S"],
  "THAT'S": ["DH", "AE0", "T", "S"], "WHO'S": ["HH", "UW0", "Z"],
  "WHAT'S": ["W", "AH0", "T", "S"], "WHERE'S": ["W", "EH0", "R", "Z"],
  "WHEN'S": ["W", "EH0", "N", "Z"], "WHY'S": ["W", "AY0", "Z"],
  "HOW'S": ["HH", "AW0", "Z"], "AIN'T": ["EY0", "N", "T"], "Y'ALL": ["Y", "AO0", "L"] */
};

// File paths
const inputFile = path.join(__dirname, "cmudict-0.7b");
const outputFile = path.join(__dirname, "en-us.txt");

// Create read and write streams
const rl = readline.createInterface({
  input: fs.createReadStream(inputFile),
  crlfDelay: Infinity
});

const outStream = fs.createWriteStream(outputFile, { encoding: "utf8" });

// Add comment
outStream.write(";;; Generated by script for the https://github.com/met4citizen/HeadTTS project\n");
outStream.write(";;; See the copyright notice for the original source data below:\n");
outStream.write(";;; \n");

let currentBase = null;
let currentPronunciations = [];

// Helper: write current base word and all its pronunciations
function flushWord() {
  if (!currentBase || currentPronunciations.length === 0) return;

  outStream.write(`${currentBase}`);
  for (const phonemes of currentPronunciations) {
    const ipaStr = phonemes.join("");
    outStream.write(`\t${ipaStr}`);
  }
  outStream.write("\n");

  currentPronunciations = [];
}

function addPronounciation(wordRaw,...phonemes) {
  const baseWord = wordRaw.replace(/\(\d+\)$/, "");
  const misaki = [];
  phonemes.forEach(ph => {
    if ( !cmuToIPA.hasOwnProperty(ph) ) {
      console.error("Found unknown phoneme: " + ph);
      process.exit(1);
    }
    const ipa = cmuToIPA[ph];
    if ( IPAToMisaki.hasOwnProperty(ipa) ) {
      misaki.push(...IPAToMisaki[ipa]);
    } else {
      misaki.push(ipa);
    }
  });

  if (baseWord !== currentBase) {
    flushWord(); // write previous word group
    currentBase = baseWord;
  }

  currentPronunciations.push(misaki);
}

rl.on("line", (line) => {
  if (!line ) return;
  if (line.startsWith(";;;")) {
    outStream.write(line + "\n");
    return;
  }

  const [wordRaw, ...phonemes] = line.trim().split(/\s+/);
  if ( reducedPronunciations.hasOwnProperty(wordRaw) ) {
    addPronounciation( wordRaw, ...reducedPronunciations[wordRaw] );
    delete reducedPronunciations[wordRaw];
  } else {
    addPronounciation( wordRaw, ...phonemes );
  }

});

rl.on("close", () => {
  flushWord(); // write last word group

  // Write the rest
  Object.keys(reducedPronunciations).forEach( x => {
    addPronounciation( x, ...reducedPronunciations[x] );
    flushWord();
  });

  outStream.end();
  console.log(`✅ Finished writing data to ${outputFile}`);
});
