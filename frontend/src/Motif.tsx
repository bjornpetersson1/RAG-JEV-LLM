/** The header's geometric motif after the owner's retro poster reference: arches, a sun, stripes (E7-13). */
export function Motif() {
  return (
    <svg className="motif" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
      <rect className="motif-frame" x="2" y="2" width="116" height="96" rx="8" />
      <path className="motif-arch" d="M16 98V50a22 22 0 0 1 44 0v48z" />
      <circle className="motif-sun" cx="38" cy="52" r="10" />
      <path className="motif-line" d="M28 98V80a10 10 0 0 1 10-10" />
      <path className="motif-arch-light" d="M70 98V64a16 16 0 0 1 32 0v34z" />
      <path className="motif-stripes" d="M70 76h32M70 84h32M70 92h32" />
      <circle className="motif-dot" cx="96" cy="22" r="8" />
    </svg>
  );
}
