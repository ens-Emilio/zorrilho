import { generationAudioUrl, exportUrl } from "../lib/sidecar";

export default function AudioPlayer({ gid }: { gid: string }) {
  const src = generationAudioUrl(gid);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio src={src} controls style={{ width: "100%", height: 28 }} preload="none" />
      <div style={{ display: "flex", gap: 6 }}>
        <a href={exportUrl(gid, "wav")} className="btn btn-secondary" style={{ flex: 1, textDecoration: "none", height: 24, fontSize: 11 }}>WAV</a>
        <a href={exportUrl(gid, "mp3")} className="btn btn-secondary" style={{ flex: 1, textDecoration: "none", height: 24, fontSize: 11 }}>MP3</a>
      </div>
    </div>
  );
}
