import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { chordVoicings, voicingTab } from '@/song/performance/voicings';
import { useRef } from 'react';

export function ChordVoicings({ chord, onClose, returnFocus }: { chord: string | null; onClose: () => void; returnFocus?: () => void }) {
  const lastChord = useRef(chord);
  if (chord) lastChord.current = chord;
  const displayChord = chord ?? lastChord.current;
  const voicings = displayChord ? chordVoicings(displayChord) : [];
  return <Dialog open={chord !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="z-[70] max-h-[85vh] overflow-y-auto sm:max-w-3xl" onEscapeKeyDown={event => event.stopPropagation()} onCloseAutoFocus={event => { if (returnFocus) { event.preventDefault(); returnFocus(); } }}>
      <DialogHeader><DialogTitle>{displayChord} · Guitar voicings</DialogTitle><DialogDescription>Standard tuning E A D G B e. Read the tab from high e at the top to low E at the bottom. x = mute; 0 = open. Barre shapes appear first.</DialogDescription></DialogHeader>
      {voicings.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{voicings.map((voicing, i) => <article key={i} className="rounded-lg border border-seam p-4">
        <h3 className="font-semibold">Position {i + 1} {voicing.barre && <span className="ml-1 text-xs text-sky-400">Barre preferred</span>}</h3>
        <p className="mb-3 text-xs text-silkscreen-3">{voicing.label}</p>
        <pre aria-label={`${displayChord} position ${i + 1} tablature`} className="font-mono text-lg leading-relaxed">{voicingTab(voicing.frets)}</pre>
        {voicing.barre && <p className="mt-2 text-xs text-silkscreen-3">Barre the repeated notes at fret {voicing.barreFret}; mute strings marked x.</p>}
      </article>)}</div> : <p>No verified voicings are available for this chord spelling. Try a standard major, minor, seventh, suspended or power chord.</p>}
    </DialogContent>
  </Dialog>;
}
