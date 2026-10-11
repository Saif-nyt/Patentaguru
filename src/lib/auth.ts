import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { MongoClient } from "mongodb";
import { Resend } from "resend";

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

function createAuth() {
  const baseURL = requiredEnv("BETTER_AUTH_URL");
  const client = new MongoClient(requiredEnv("MONGODB_URI"));
  const dbName = process.env.MONGODB_DB_NAME || "patente_bangla";
  const db = client.db(dbName);
  const resend = new Resend(requiredEnv("RESEND_API_KEY"));

  return betterAuth({
    appName: "PatenteBangla",
    baseURL,
    secret: requiredEnv("BETTER_AUTH_SECRET"),
    trustedOrigins: [baseURL],
    database: mongodbAdapter(db, { client }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        const from = process.env.EMAIL_FROM?.trim() || "PatenteBangla <onboarding@resend.dev>";
        if (!process.env.EMAIL_FROM) {
          console.warn(
            "EMAIL_FROM is not set - falling back to Resend's test sender " +
              "(onboarding@resend.dev), which can only deliver to the Resend account's own email."
          );
        }

        const { data, error } = await resend.emails.send({
          from,
          to: user.email,
          subject: "Verify your PatenteBangla email address",
          html: `<p>Verify your email address to finish setting up your PatenteBangla account.</p><p><a href="${url}">Verify email address</a></p><p>If the link does not work, copy it into your browser: ${url}</p>`,
        });

        if (error) {
          console.error("Resend verification email failed:", error.message);
          throw new Error(`Resend could not send the verification email: ${error.message}`);
        }

        if (!data?.id) {
          console.error("Resend verification email returned no email ID.");
          throw new Error("Resend did not confirm the verification email.");
        }

        console.info("Verification email accepted by Resend:", data.id);
      },
    },
    socialProviders: {
      google: {
        clientId: requiredEnv("GOOGLE_CLIENT_ID"),
        clientSecret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      },
    },
    user: {
      additionalFields: {
        phone: {
          type: "string",
          required: false,
          input: true,
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

let cachedAuth: Auth | null = null;

const getAuth = (): Auth => {
  if (!cachedAuth) cachedAuth = createAuth();
  return cachedAuth;
};

// `next build` imports this module to collect page data, before runtime env
// vars are guaranteed. Proxying keeps the `auth` export shape identical while
// deferring config reads (and the Mongo connection) until the first request.
export const auth: Auth = new Proxy({} as Auth, {
  get: (_target, prop, receiver) => Reflect.get(getAuth(), prop, receiver),
  has: (_target, prop) => Reflect.has(getAuth(), prop),
  ownKeys: () => Reflect.ownKeys(getAuth()),
  getOwnPropertyDescriptor: (_target, prop) => {
    const descriptor = Reflect.getOwnPropertyDescriptor(getAuth(), prop);
    if (descriptor) descriptor.configurable = true;
    return descriptor;
  },
});
