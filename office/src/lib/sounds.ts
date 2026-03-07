// Sound effects for Oracle Office

const sounds = [
  "/office/saiyan.mp3",
  "/office/saiyan-aura.mp3",
  "/office/saiyan-rose.mp3",
  "/office/saiyan-2.mp3",
];

const MAX_PLAY = 3; // seconds before fade-out starts
const FADE_MS = 1500; // fade-out duration

/** Play a random super saiyan sound with auto fade-out */
export function playSaiyanSound() {
  try {
    const src = sounds[Math.floor(Math.random() * sounds.length)];
    const audio = new Audio(src);
    audio.volume = 0.3;
    audio.play().catch(() => {});

    // Start fade-out after MAX_PLAY seconds
    setTimeout(() => {
      const startVol = audio.volume;
      const steps = 30;
      const stepMs = FADE_MS / steps;
      let step = 0;
      const fade = setInterval(() => {
        step++;
        audio.volume = Math.max(0, startVol * (1 - step / steps));
        if (step >= steps) {
          clearInterval(fade);
          audio.pause();
        }
      }, stepMs);
    }, MAX_PLAY * 1000);
  } catch {}
}
