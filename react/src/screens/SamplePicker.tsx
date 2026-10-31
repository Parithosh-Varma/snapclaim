import { useEffect, useRef } from "react";
import { SAMPLE_PHOTOS, sampleUrl } from "../lib/sample";

export function SamplePicker({ open, onClose, onPick }: {
  open: boolean;
  onClose: () => void;
  onPick: (file: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else if (ref.current?.open) ref.current.close();
  }, [open ]);
  return (
    <dialog
      ref={ref}
      className="sampledlg"
      aria-labelledby="h-sample"
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
    >
      <h2 id="h-sample">Pick a sample photo</h2>
      <p className="sub">Real field photos — tap one to mark and measure its damage.</p>
      <div className="samplegrid">
        {SAMPLE_PHOTOS.map((p) => (
          <button key={p.file} type="button" className="samplecell" onClick={() => onPick(p.file)}>
            <img src={sampleUrl(p.file)} alt={p.label} loading="lazy" />
            <small>{p.label}</small>
          </button>
        ))}
      </div>
      <button type="button" className="btn-ghostline" onClick={() => ref.current?.close()}>Close</button>
    </dialog>
  );
}
