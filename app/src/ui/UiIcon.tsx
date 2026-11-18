const paths = {
  today: "M4 8h16M8 3v4m8-4v4M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm3 9 2.5 2.5L16 11",
  manual: "M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14",
  settings: "M3 7h5m4 0h9M3 17h10m4 0h4M12 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm5 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  search: "M16 16l5 5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z",
};

export function UiIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg class="lg-ui-icon" viewBox="0 0 24 24" width="18" height="18" fill="none"
      stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
      stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
