"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "./auth";

export const authClient = createAuthClient({
  fetchOptions: {
    timeout: 15_000,
  },
  plugins: [inferAdditionalFields<typeof auth>()],
});
