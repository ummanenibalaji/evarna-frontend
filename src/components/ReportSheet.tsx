// ReportSheet.tsx — report an AI reply (App Store Guideline 1.2).
//
// Opened by long-pressing a companion reply, or through the bubble's
// "Report this reply" VoiceOver action. Any screen that shows generated
// replies with a turn id can use it: <ReportSheet turnId={id} onClose={…} />.

import React, { useEffect, useRef, useState, type RefObject } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { createReport, type ReportReason } from '../api';
import { announce } from '../hooks/useAccessibilityPrefs';
import { haptic } from '../lib/haptics';
import { R, resolveFont, SP, TYPE, W } from '../theme/theme';
import { InlineNotice, Pill, PrimaryButton } from './Atoms';
import { Sheet } from './Sheet';
import { Txt } from './Txt';

const REASONS: { k: ReportReason; l: string }[] = [
  { k: 'harmful', l: 'Harmful or unsafe' },
  { k: 'sexual', l: 'Sexual content' },
  { k: 'inappropriate_minor', l: 'Inappropriate for a minor' },
  { k: 'inaccurate', l: 'Inaccurate' },
  { k: 'other', l: 'Something else' },
];

const NOTE_MAX = 1000;
// Long enough to read the thanks, short enough not to feel stuck.
const CLOSE_AFTER_SENT_MS = 1600;

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

/** `turnId` null keeps the sheet closed; the sheet animates out before it
 *  unmounts. `returnFocusRef`: the reply that opened it, where VoiceOver
 *  focus goes back once it closes. */
export function ReportSheet({ turnId, onClose, returnFocusRef }: {
  turnId: string | null; onClose: () => void; returnFocusRef?: RefObject<View | null>;
}) {
  // Held while the sheet animates out, so the content doesn't blank mid-slide.
  const [target, setTarget] = useState(turnId);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<SendState>('idle');
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    clearTimeout(closeTimer.current);
  }, []);

  // Every opening starts a fresh report.
  const wasOpen = useRef(!!turnId);
  useEffect(() => {
    const opening = !!turnId && (!wasOpen.current || turnId !== target);
    wasOpen.current = !!turnId;
    // Closed by hand before the thanks timed out: nothing left to close.
    if (!turnId) clearTimeout(closeTimer.current);
    if (!opening) return;
    clearTimeout(closeTimer.current);
    setTarget(turnId);
    setReason(null);
    setNote('');
    setState('idle');
  }, [turnId, target]);

  const submit = async () => {
    if (!target || !reason || state === 'sending' || state === 'sent') return;
    setState('sending');
    try {
      await createReport(target, reason, note.trim() || undefined);
      if (!mounted.current) return;
      setState('sent');
      haptic.success();
      announce("Report sent. Thanks, we'll review it.");
      closeTimer.current = setTimeout(onClose, CLOSE_AFTER_SENT_MS);
    } catch {
      if (!mounted.current) return;
      // The reason and note stay as they were, so trying again is one tap.
      setState('failed');
      haptic.error();
    }
  };

  const sent = state === 'sent';
  const footer = sent ? (
    <PrimaryButton variant="secondary" onPress={onClose} haptic={false}>Done</PrimaryButton>
  ) : (
    <>
      <PrimaryButton
        onPress={submit}
        disabled={!reason}
        loading={state === 'sending'}
        accessibilityHint={reason ? undefined : 'Choose what was wrong first'}
      >
        {state === 'failed' ? 'Try again' : 'Submit report'}
      </PrimaryButton>
      <PrimaryButton variant="text" onPress={onClose} haptic={false}>Cancel</PrimaryButton>
    </>
  );

  return (
    <Sheet visible={!!turnId} onClose={onClose} title="Report this reply" footer={footer} returnFocusRef={returnFocusRef}>
      {sent ? (
        <View accessible style={styles.sent}>
          <Txt variant="headline" color={W.cream} style={styles.center}>Thanks — we'll review it.</Txt>
          <Txt variant="subhead" color={W.text2} style={styles.center}>
            Reports help us keep conversations safe.
          </Txt>
        </View>
      ) : (
        <>
          <Txt variant="subhead" color={W.text2}>What was wrong with it?</Txt>
          <View accessibilityRole="radiogroup" accessibilityLabel="What was wrong" style={styles.reasons}>
            {REASONS.map(r => (
              <Pill key={r.k} size="sm" selected={reason === r.k} onPress={() => setReason(r.k)}>{r.l}</Pill>
            ))}
          </View>
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={NOTE_MAX}
            multiline
            placeholder="Add a note (optional)"
            placeholderTextColor={W.placeholder}
            selectionColor={W.primary}
            cursorColor={W.primary}
            accessibilityLabel="Note, optional"
            maxFontSizeMultiplier={TYPE.callout.maxScale}
            style={styles.note}
          />
          {state === 'failed' ? (
            <InlineNotice tone="error" text="Couldn't send your report. Try again." style={styles.error} />
          ) : null}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sent: { paddingVertical: SP.lg, gap: SP.sm },
  center: { textAlign: 'center' },
  reasons: { marginTop: SP.md2, gap: SP.sm },
  note: {
    marginTop: SP.md2, minHeight: 72, maxHeight: 140,
    paddingHorizontal: SP.md2, paddingTop: SP.sm2, paddingBottom: SP.sm2,
    borderRadius: R.md, borderWidth: 1, borderColor: W.hairline, backgroundColor: W.surface3,
    color: W.text, fontFamily: resolveFont('user', 400), fontSize: TYPE.callout.size,
    textAlignVertical: 'top',
  },
  error: { marginTop: SP.md },
});
