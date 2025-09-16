(function(){
  if (typeof window === 'undefined') return;
  window.GG = window.GG || {};
  if (typeof window.GG.incPlays !== 'function') window.GG.incPlays = function(){};
  if (typeof window.GG.playSnd !== 'function') window.GG.playSnd = function(){};
  if (typeof window.GG.log !== 'function') window.GG.log = function(){};
})();