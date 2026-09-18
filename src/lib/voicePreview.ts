/**
 * Voice previews: short bundled clips, one per backend voice, played with
 * expo-audio.
 *
 * Each voice has two clips (rendered by the backend's voice:samples script):
 *   preview   "Hey, I'm Maya. I'm really glad you're here." — the voice picker
 *   greeting  "Hi. It's really good to finally meet you."   — the Meet screen,
 *             with no name in it, because the user names the companion.
 *
 * expo-audio is a native module, so it is required lazily (same pattern as
 * lib/notifications.ts): a build without it loses previews, not the whole
 * onboarding flow that imports this file.
 */
import { useEffect, useState } from 'react';
import type * as ExpoAudio from 'expo-audio';

export type VoiceClip = 'preview' | 'greeting';

/**
 * Why a clip is playing, which decides how it treats the phone's sound.
 *   tap   the user tapped for it: plays even with the Ring/Silent switch on
 *         silent, and ducks whatever else is playing.
 *   auto  it plays by itself (the Meet greeting): follows the silent switch,
 *         so a phone on silent stays silent, and mixes with other audio
 *         instead of interrupting it.
 */
export type VoicePlayback = 'tap' | 'auto';

/** What the greeting clip says, word for word, for captions and VoiceOver. */
export const GREETING_TEXT = "Hi. It's really good to finally meet you.";

// Static requires so Metro bundles the clips. Keyed by the backend's voice id.
const CLIPS: Record<VoiceClip, Map<string, number>> = {
  preview: new Map([
    ['944adf80-0d6e-4909-b6fa-078784d6f8c5', require('../../assets/voices/944adf80-0d6e-4909-b6fa-078784d6f8c5.mp3')], // Kai
    ['3866d4e7-0188-4010-92be-836d927e84e0', require('../../assets/voices/3866d4e7-0188-4010-92be-836d927e84e0.mp3')], // Theo
    ['c050bc97-0e14-44ba-8c23-ae353fee972d', require('../../assets/voices/c050bc97-0e14-44ba-8c23-ae353fee972d.mp3')], // Maya
    ['3cd1f2e8-12f0-48b5-ade4-9e06241b8252', require('../../assets/voices/3cd1f2e8-12f0-48b5-ade4-9e06241b8252.mp3')], // Iris
  ]),
  greeting: new Map([
    ['944adf80-0d6e-4909-b6fa-078784d6f8c5', require('../../assets/voices/944adf80-0d6e-4909-b6fa-078784d6f8c5-greeting.mp3')], // Kai
    ['3866d4e7-0188-4010-92be-836d927e84e0', require('../../assets/voices/3866d4e7-0188-4010-92be-836d927e84e0-greeting.mp3')], // Theo
    ['c050bc97-0e14-44ba-8c23-ae353fee972d', require('../../assets/voices/c050bc97-0e14-44ba-8c23-ae353fee972d-greeting.mp3')], // Maya
    ['3cd1f2e8-12f0-48b5-ade4-9e06241b8252', require('../../assets/voices/3cd1f2e8-12f0-48b5-ade4-9e06241b8252-greeting.mp3')], // Iris
  ]),
};

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

/** Whether this voice has a clip of that kind this build can play. Hide the
 *  preview control (or stay silent) otherwise. */
export function hasVoicePreview(voiceId: string, clip: VoiceClip = 'preview'): boolean {
  return CLIPS[clip].has(voiceId) && loadAudio() !== null;
}

// iOS refuses to duck other audio when it also has to follow the silent
// switch, so the quiet mode mixes instead.
const SESSION_MODES: Record<VoicePlayback, Partial<ExpoAudio.AudioMode>> = {
  tap: {
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    shouldPlayInBackground: false,
    allowsRecording: false,
  },
  auto: {
    playsInSilentMode: false,
    interruptionMode: 'mixWithOthers',
    shouldPlayInBackground: false,
    allowsRecording: false,
  },
};

// The audio session is app-wide, so the mode last asked for is too. It is
// forgotten whenever a preview hook mounts, because a voice call since then
// may have reconfigured the session behind this module's back.
let session: { playback: VoicePlayback; ready: Promise<void> } | null = null;

function sessionFor(A: typeof ExpoAudio, playback: VoicePlayback): Promise<void> {
  if (session?.playback === playback) return session.ready;
  const ready = A.setAudioModeAsync(SESSION_MODES[playback])
    .catch(e => { console.warn('[VoicePreview] audio mode not applied:', e); });
  session = { playback, ready };
  return ready;
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

  const play = (voiceId: string, clip: VoiceClip = 'preview', playback: VoicePlayback = 'tap') => {
    const A = loadAudio();
    const source = CLIPS[clip].get(voiceId);
    if (!A || source === undefined) return;

    if (activeOwner && activeOwner !== owner) activeOwner.yieldTo();
    activeOwner = owner;
    const req = ++request;
    setPlayingId(voiceId);

    // A tapped preview is heard even on silent; a clip nobody tapped for
    // follows the switch (it still "plays", muted, and ends as usual).
    sessionFor(A, playback).then(() => {
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
    mount: () => {
      mounted = true;
      session = null;
    },
    unmount: () => {
      mounted = false;
      halt(true);
    },
  };
}

/**
 * One clip at a time. `playingId` is the voice whose clip is playing (or
 * about to), and clears when the clip ends, fails or `stop()` is called.
 * Playing a voice again restarts it. `clip` picks the preview (default) or the
 * greeting; `playback` says whether the user tapped for it (default) or it
 * plays by itself (see VoicePlayback). Playback stops and the player is
 * released on unmount.
 */
export function useVoicePreview(): {
  playingId: string | null;
  play: (voiceId: string, clip?: VoiceClip, playback?: VoicePlayback) => void;
  stop: () => void;
} {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [preview] = useState(() => createPreview(setPlayingId));

  useEffect(() => {
    preview.mount();
    return preview.unmount;
  }, [preview]);

  return { playingId, play: preview.play, stop: preview.stop };
}
