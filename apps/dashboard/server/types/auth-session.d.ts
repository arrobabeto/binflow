declare module 'h3' {
  interface H3EventContext {
    dashboardSession: {
      session?: { updatedAt?: Date | string | number };
      user?: { twoFactorEnabled?: boolean | null };
    } | null;
  }
}

export {};
