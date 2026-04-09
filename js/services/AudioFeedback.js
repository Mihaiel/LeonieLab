/*
  AudioFeedback
  -------------
  Plays short tones via the Web Audio API to give instant feedback
  when a student enters a result digit.

  AudioContext is created lazily on the first call — browsers require
  a user gesture before audio can start, which is always satisfied here
  since tones are triggered by keypresses.

  Usage:
    const audio = new AudioFeedback();
    audio.correct();   // bright high tone — answer is right
    audio.wrong();     // low dull tone   — answer is wrong
*/

export class AudioFeedback {
  constructor() {
    this._ctx = null;
  }

  _getCtx() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._ctx;
  }

  _tone(freq, type, duration, gain) {
    const ctx = this._getCtx();
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, ctx.currentTime);
    amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  }

  // Bright A5 sine — short and positive
  correct() { this._tone(880, 'sine', 0.25, 0.12); }

  // Low A2 sawtooth — dull and brief
  wrong()   { this._tone(200, 'sawtooth', 0.30, 0.10); }
}
