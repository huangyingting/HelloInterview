import { updateProfile } from '../../../server/next/identity';
import { readJson, routeError } from '../../../server/next/response';

export async function PATCH(request: Request) {
  try {
    return Response.json(await updateProfile(request, await readJson(request, 4096)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeError(error, 'profile.update.failed');
  }
}
