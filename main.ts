import { resolve, TYPE_A } from "./resolve.ts";

console.log(await resolve(Deno.args[0], TYPE_A));
