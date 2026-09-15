export type NavigationIconName =
  | 'walk'
  | 'bike'
  | 'straight'
  | 'left'
  | 'right'
  | 'uturn'
  | 'roundabout'
  | 'pin'
  | 'close'
  | 'options'
  | 'locate'
  | 'route'
  | 'flag';

export default function NavigationIcon({ name }: { name: NavigationIconName }) {
  return (
    <svg
      className="navigation-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'walk' ? (
        <>
          <circle cx="14" cy="4" r="2" />
          <path d="m7 21 3-7 3 3v4M6 11l4-3 4 1 3 4h3M10 8l-1 6 5 1 2-6" />
        </>
      ) : null}
      {name === 'bike' ? (
        <>
          <circle cx="5" cy="17" r="4" />
          <circle cx="19" cy="17" r="4" />
          <path d="m5 17 5-9 5 9H5M8 8h5m2-4h3l3 13M10 8l5 9 3-10" />
        </>
      ) : null}
      {name === 'straight' ? <path d="M12 21V3m-7 7 7-7 7 7" /> : null}
      {name === 'left' ? <path d="M18 21v-9a5 5 0 0 0-5-5H3m6-6L3 7l6 6" /> : null}
      {name === 'right' ? <path d="M6 21v-9a5 5 0 0 1 5-5h10m-6-6 6 6-6 6" /> : null}
      {name === 'uturn' ? <path d="M18 21V8a6 6 0 0 0-12 0v8m-4-4 4 4 4-4" /> : null}
      {name === 'roundabout' ? <path d="M12 22v-5a6 6 0 1 1 6-6V2m-4 4 4-4 4 4" /> : null}
      {name === 'pin' ? (
        <>
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </>
      ) : null}
      {name === 'close' ? <path d="m6 6 12 12M6 18 18 6" /> : null}
      {name === 'options' ? (
        <>
          <path d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="9" cy="6" r="2" fill="currentColor" />
          <circle cx="16" cy="12" r="2" fill="currentColor" />
          <circle cx="8" cy="18" r="2" fill="currentColor" />
        </>
      ) : null}
      {name === 'locate' ? (
        <>
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
        </>
      ) : null}
      {name === 'flag' ? <path d="M5 22V3m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0" /> : null}
      {name === 'route' ? (
        <>
          <circle cx="6" cy="5" r="2" />
          <circle cx="18" cy="19" r="2" />
          <path d="M8 5h7a4 4 0 0 1 0 8H9a3 3 0 0 0 0 6h7" />
        </>
      ) : null}
    </svg>
  );
}
