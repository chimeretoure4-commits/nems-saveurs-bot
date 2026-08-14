// Utilities: sanitization and french number words to digits
function sanitizeText(text){
  if(!text) return '';
  return String(text).trim();
}

const WORD_NUMBERS = {
  'cinq':5,'dix':10,'quinze':15,'vingt':20,'vingt-cinq':25,'vingt cinq':25,'trente':30,'trente-cinq':35,'trente cinq':35,'quarante':40,'quarante-cinq':45,'quarante cinq':45,'cinquante':50,'un':1,'deux':2,'trois':3,'quatre':4,'six':6,'sept':7,'huit':8,'neuf':9,'onze':11,'douze':12,'treize':13,'quatorze':14
};

function wordsToNumber(text){
  if(!text) return null;
  const t = text.toLowerCase().replace(/-/g,' ').replace(/\s+/g,' ').trim();
  // direct map
  if(WORD_NUMBERS[t] !== undefined) return WORD_NUMBERS[t];
  // match a word in text
  for(const [w,v] of Object.entries(WORD_NUMBERS)){
    if(t.includes(w)) return v;
  }
  return null;
}

module.exports = { sanitizeText, wordsToNumber };
