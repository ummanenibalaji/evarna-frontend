/**
 * Voice previews: short bundled clips, one per backend voice, played with
 * expo-audio.
 *
 * expo-audio is a native module, so it is required lazily (same pattern as
 * lib/notifications.ts): a build without it loses previews, not the whole
 * onboarding flow that imports this file.
 */
import { useEffect, useState } from 'react';
import type * as ExpoAudio from 'expo-audio';

// Static requires so Metro bundles the clips. Keyed by the backend's voice id.
const CLIPS = new Map<string, number>([
  ['944adf80-0d6e-4909-b6fa-078784d6f8c5', require('../../assets/voices/944adf80-0d6e-4909-b6fa-078784d6f8c5.mp3')], // Kai
  ['3866d4e7-0188-4010-92be-836d927e84e0', require('../../assets/voices/3866d4e7-0188-4010-92be-836d927e84e0.mp3')], // Theo
  ['c050bc97-0e14-44ba-8c23-ae353fee972d', require('../../assets/voices/c050bc97-0e14-44ba-8c23-ae353fee972d.mp3')], // Maya
  ['3cd1f2e8-12f0-48b5-ade4-9e06241b8252', require('../../assets/voices/3cd1f2e8-12f0-48b5-ade4-9e06241b8252.mp3')], // Iris
]);

let audio: typeof ExpoAudio | null | undefined;

function loadAudio(): typeof ExpoAudio | null {
  if (audio === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      audio = require('expo-audio') as typeof ExpoAudio;
    } catch (e) {
      console.warn('[VoicePreview] expo-audio is unavailable in this build:', e);
      audio = null;
    }
  }
  return audio;
}

/** Whether this voice has a clip this build can play. Hide the preview control otherwise. */
export function hasVoicePreview(voiceId: string): boolean {
  return CLIPS.has(voiceId) && loadAudio() !== null;
}

interface Owner {
  /** Stop without handing audio back: the new owner is about to play. */
  yieldTo: () => void;
}

// Whoever is playing, so starting a preview anywhere stops the one before it.
let activeOwner: Owner | null = null;

// The player of the clip in progress; released as soon as it ends.
interface Playing {
  player: ExpoAudio.AudioPlayer;
  sub: { remove: () => void };
}

// One controller per mounted hook. Plain closures rather than refs and
// callbacks: nothing here needs to re-render except the playing id.
function createPreview(setPlayingId: (id: string | null) => void) {
  let current: Playing | null = null;
  // Bumped on every play/stop, so a play still waiting on the audio mode can
  // tell it has been superseded.
  let request = 0;
  let modeReady: Promise<void> | null = null;
  let mounted = true;

  // `pause()` is what hands audio back to other apps: expo-audio deactivates
  // the session when a player pauses or finishes. `release()` alone does not,
  // which is what switching between two clips wants.
  const releasePlayer = (handBackAudio: boolean) => {
    const cur = current;
    if (!cur) return;
    current = null;
    cur.sub.remove();
    if (handBackAudio) cur.player.pause();
    cur.player.release();
  };

  const halt = (handBackAudio: boolean) => {
    request++;
    releasePlayer(handBackAudio);
    if (activeOwner === owner) activeOwner = null;
    if (mounted) setPlayingId(null);
  };

  const owner: Owner = { yieldTo: () => halt(false) };

  const play = (voiceId: string) => {
    const A = loadAudio();
    const source = CLIPS.get(voiceId);
    if (!A || source === undefined) return;

    if (activeOwner && activeOwner !== owner) activeOwner.yieldTo();
    activeOwner = owner;
    const req = ++request;
    setPlayingId(voiceId);

    // Previews must be audible with the silent switch on, and duck (then
    // restore) whatever else is playing. Applied once per mount, because a
    // call since the last mount may have reconfigured the session.
    modeReady ??= A.setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      shouldPlayInBackground: false,
      allowsRecording: false,
    }).catch(e => { console.warn('[VoicePreview] audio mode not applied:', e); });

    modeReady.then(() => {
      if (req !== request || !mounted) return;
      releasePlayer(false);
      try {
        const player = A.createAudioPlayer(source);
        const sub = player.addListener('playbackStatusUpdate', status => {
          if (status.didJustFinish && current?.player === player) halt(false);
        });
        current = { player, sub };
        player.play();
      } catch (e) {
        console.warn('[VoicePreview] playback failed:', e);
        halt(true);
      }
    });
  };

  return {
    play,
    stop: () => halt(true),
    mount: () => { mounted = true; },
    unmount: () => {
      mounted = false;
      halt(true);
    },
  };
}

/**
 * One preview at a time. `playingId` is the voice whose clip is playing (or
 * about to), and clears when the clip ends or `stop()` is called. Playing a
 * voice again restarts it. Playback stops and the player is released on
 * unmount.
 */
export function useVoicePreview(): { playingId: string | null; play: (voiceId: string) => void; stop: () => void } {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [preview] = useState(() => createPreview(setPlayingId));

  useEffect(() => {
    preview.mount();
    return preview.unmount;
  }, [preview]);

  return { playingId, play: preview.play, stop: preview.stop };
}
