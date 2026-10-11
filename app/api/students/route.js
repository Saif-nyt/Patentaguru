import { toRoute } from '../../../server/api/_next.js';
import handler from '../../../server/api/students.js';

export const dynamic = 'force-dynamic';

const route = toRoute(handler);

export const GET = route;
export const POST = route;
export const PUT = route;
export const PATCH = route;
export const DELETE = route;
export const OPTIONS = route;
