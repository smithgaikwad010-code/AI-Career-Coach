export default function EvidenceList({ evidence }) {
  if (!evidence?.length) return null;
  return (
    <ul className="evidence" aria-label="Evidence">
      {evidence.map((e, i) => (
        <li key={`${e.repo}${e.file}${e.line}${i}`}>
          <a href={e.url} target="_blank" rel="noopener noreferrer"><code>{e.repo}/{e.file}:{e.line}</code></a>
          <span className="reason">{e.reason}</span>
        </li>
      ))}
    </ul>
  );
}
