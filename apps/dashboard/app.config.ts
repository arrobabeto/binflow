export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      neutral: 'zinc',
      success: 'emerald',
      warning: 'amber',
      error: 'red',
      info: 'sky',
    },
    card: {
      slots: {
        root: 'bg-[var(--binflow-surface)] ring-[var(--binflow-border)]',
        header: 'border-[var(--binflow-border)]',
        body: '',
        footer: 'border-[var(--binflow-border)]',
      },
    },
    modal: {
      slots: {
        overlay: 'bg-black/70',
        content: 'bg-[var(--binflow-surface)] ring-[var(--binflow-border)]',
      },
    },
  },
});
