const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

const make = (children, extra) =>
  function Icon(props) {
    return (
      <svg {...base} {...extra} {...props}>
        {children}
      </svg>
    );
  };

export const IconPlus = make(<path d="M8 3v10M3 8h10" />);
export const IconMinus = make(<path d="M3.5 8h9" />);
export const IconSearch = make(
  <>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3 3" />
  </>,
);
export const IconSliders = make(
  <>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </>,
);
export const IconMore = make(
  <>
    <circle cx="3.5" cy="8" r="0.6" fill="currentColor" />
    <circle cx="8" cy="8" r="0.6" fill="currentColor" />
    <circle cx="12.5" cy="8" r="0.6" fill="currentColor" />
  </>,
  { strokeWidth: 1.6 },
);
export const IconMenu = make(<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />);
export const IconClose = make(<path d="m4 4 8 8M12 4l-8 8" />);
export const IconUndo = make(
  <>
    <path d="M5.5 3.5 2.5 6.5l3 3" />
    <path d="M2.5 6.5h7a4 4 0 0 1 0 8h-2" />
  </>,
);
export const IconRedo = make(
  <>
    <path d="m10.5 3.5 3 3-3 3" />
    <path d="M13.5 6.5h-7a4 4 0 0 0 0 8h2" />
  </>,
);
export const IconArchive = make(
  <>
    <rect x="2" y="3" width="12" height="3" rx="0.5" />
    <path d="M3 6v6.5a.5.5 0 0 0 .5.5h9a.5.5 0 0 0 .5-.5V6M6.5 8.5h3" />
  </>,
);
export const IconTrash = make(
  <>
    <path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4 4.25l.6 8.6a.5.5 0 0 0 .5.4h5.8a.5.5 0 0 0 .5-.4l.6-8.6" />
  </>,
);
export const IconCopy = make(
  <>
    <rect x="5" y="5" width="8.5" height="8.5" rx="1" />
    <path d="M11 5V3a.5.5 0 0 0-.5-.5h-7.5a.5.5 0 0 0-.5.5v7.5a.5.5 0 0 0 .5.5H5" />
  </>,
);
export const IconLink = make(
  <>
    <circle cx="4" cy="12" r="1.75" />
    <circle cx="12" cy="4" r="1.75" />
    <path d="M5.5 10.5c1.5-.5 2.5-1.5 2.5-2.5S9 6 10.5 5.5" />
  </>,
);
export const IconRotateLeft = make(
  <>
    <path d="M3 3v3.5h3.5" />
    <path d="M3.3 6.5A5 5 0 1 1 4 11" />
  </>,
);
export const IconRotateRight = make(
  <>
    <path d="M13 3v3.5H9.5" />
    <path d="M12.7 6.5A5 5 0 1 0 12 11" />
  </>,
);
export const IconEdit = make(<path d="M10.5 2.75 13.25 5.5 6 12.75H3.25V10z" />);
export const IconSettings = make(
  <>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.4 3.6l-1.06 1.06M4.66 11.34 3.6 12.4M12.4 12.4l-1.06-1.06M4.66 4.66 3.6 3.6" />
  </>,
);
export const IconCheck = make(<path d="m3.5 8.5 3 3 6-7" />);
export const IconRestore = make(
  <>
    <path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.78" />
    <path d="M2.75 2.75v2.5h2.5" />
  </>,
);
export const IconFit = make(
  <>
    <path d="M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3" />
  </>,
);
export const IconTidy = make(
  <>
    <rect x="2.5" y="2.5" width="4.5" height="5" rx="0.5" />
    <rect x="9" y="2.5" width="4.5" height="3" rx="0.5" />
    <rect x="2.5" y="9.5" width="4.5" height="4" rx="0.5" />
    <rect x="9" y="7.5" width="4.5" height="6" rx="0.5" />
  </>,
);
export const IconDownload = make(<path d="M8 2.5v8M4.75 7.25 8 10.5l3.25-3.25M3 13.5h10" />);
export const IconUpload = make(<path d="M8 10.5v-8M4.75 5.75 8 2.5l3.25 3.25M3 13.5h10" />);
export const IconGrip = make(
  <>
    <circle cx="6" cy="5" r="0.5" fill="currentColor" />
    <circle cx="10" cy="5" r="0.5" fill="currentColor" />
    <circle cx="6" cy="8" r="0.5" fill="currentColor" />
    <circle cx="10" cy="8" r="0.5" fill="currentColor" />
    <circle cx="6" cy="11" r="0.5" fill="currentColor" />
    <circle cx="10" cy="11" r="0.5" fill="currentColor" />
  </>,
);

export const IconSmile = make(
  <>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M5.6 9.6c.6.8 1.4 1.2 2.4 1.2s1.8-.4 2.4-1.2" />
    <circle cx="6" cy="6.6" r=".5" fill="currentColor" />
    <circle cx="10" cy="6.6" r=".5" fill="currentColor" />
  </>,
);

export const IconArrowLeft = make(<path d="M12.5 8h-9M7 4.5 3.5 8 7 11.5" />);
export const IconArrowRight = make(<path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" />);
export const IconArrowUp = make(<path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />);
export const IconArrowDown = make(<path d="M8 3.5v9M4.5 9 8 12.5 11.5 9" />);

/** POST IT mark: a pink sticky note with a folded corner. */
export function Logo({ size = 20, title = 'POST IT' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" role="img" aria-label={title}>
      <path d="M3 2.5h14a.5.5 0 0 1 .5.5v9.6L12.6 17.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" fill="#F7B9C6" />
      <path d="M17.5 12.6h-4.4a.5.5 0 0 0-.5.5v4.4z" fill="#E48FA3" />
      <path d="M5.5 6.5h7M5.5 9h5" stroke="#A9536A" strokeWidth="1" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

export const IconCompose = make(
  <>
    <path d="M13 9v3.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H7" />
    <path d="M12.2 2.3a1.1 1.1 0 0 1 1.5 1.5L8.2 9.3 6 10l.7-2.2z" />
  </>,
);
export const IconSidebar = make(
  <>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6 3v10M3.6 5.6h1M3.6 7.6h1" />
  </>,
);
export const IconMoon = make(<path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z" />);
export const IconFolder = make(
  <path d="M2.5 4.5a1 1 0 0 1 1-1h2.8l1.4 1.5h4.8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />,
);
export const IconFolderPlus = make(
  <>
    <path d="M2.5 4.5a1 1 0 0 1 1-1h2.8l1.4 1.5h4.8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
    <path d="M8 7.2v3.6M6.2 9h3.6" />
  </>,
);
export const IconChevron = make(<path d="m6 4 4 4-4 4" />);
export const IconPlusCircle = make(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5.3v5.4M5.3 8h5.4" />
  </>,
);

export const IconSpeaker = make(
  <>
    <path d="M2.5 6.2v3.6h2.3L8 12.5v-9L4.8 6.2z" />
    <path d="M10.4 5.9a3 3 0 0 1 0 4.2M12.2 4.2a5.4 5.4 0 0 1 0 7.6" />
  </>,
);
export const IconSpeakerOff = make(
  <>
    <path d="M2.5 6.2v3.6h2.3L8 12.5v-9L4.8 6.2z" />
    <path d="M10.5 6.3l3 3.4M13.5 6.3l-3 3.4" />
  </>,
);
export const IconEye = make(
  <>
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </>,
);
export const IconEyeOff = make(
  <>
    <path d="M6.2 3.8A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5s-.7 1.3-2 2.5M4.1 5A9.7 9.7 0 0 0 1.5 8s2.4 4.5 6.5 4.5c1 0 1.9-.3 2.7-.7" />
    <path d="M6.6 6.6a2 2 0 0 0 2.8 2.8M2.5 2.5l11 11" />
  </>,
);
export const IconLock = make(
  <>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.6" />
    <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
  </>,
);
export const IconChevronRight = make(<path d="M6.5 3.5 11 8l-4.5 4.5" />);
export const IconChevronLeft = make(<path d="M9.5 3.5 5 8l4.5 4.5" />);

// A proper gear (the old settings glyph read as a sun).
export const IconGear = make(
  <>
    <path d="M12.96 6.13 L14.76 6.63 L14.76 9.37 L12.96 9.87 L12.83 10.19 L13.75 11.81 L11.81 13.75 L10.19 12.83 L9.87 12.96 L9.37 14.76 L6.63 14.76 L6.13 12.96 L5.81 12.83 L4.19 13.75 L2.25 11.81 L3.17 10.19 L3.04 9.87 L1.24 9.37 L1.24 6.63 L3.04 6.13 L3.17 5.81 L2.25 4.19 L4.19 2.25 L5.81 3.17 L6.13 3.04 L6.63 1.24 L9.37 1.24 L9.87 3.04 L10.19 3.17 L11.81 2.25 L13.75 4.19 L12.83 5.81Z" />
    <circle cx="8" cy="8" r="2.1" />
  </>,
);
export const IconShare = make(
  <>
    <path d="M8 2.5v8M5.2 5.2 8 2.5l2.8 2.7" />
    <path d="M5.5 7H4.2a.9.9 0 0 0-.9.9v5a.9.9 0 0 0 .9.9h7.6a.9.9 0 0 0 .9-.9v-5a.9.9 0 0 0-.9-.9h-1.3" />
  </>,
);
export const IconImage = make(
  <>
    <rect x="2.5" y="3" width="11" height="10" rx="1.6" />
    <circle cx="6" cy="6.5" r="1.1" />
    <path d="m2.8 11.6 3.4-3.2 2.4 2.2 1.9-1.6 2.8 2.5" />
  </>,
);
export const IconFileText = make(
  <>
    <path d="M4.2 1.9h5.2l3 3v9a.6.6 0 0 1-.6.6H4.2a.6.6 0 0 1-.6-.6V2.5a.6.6 0 0 1 .6-.6z" />
    <path d="M9.2 2v3h3M5.8 8.2h4.4M5.8 10.6h4.4" />
  </>,
);
