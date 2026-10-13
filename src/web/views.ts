import path from 'node:path';
import { Eta } from 'eta';

export function createViews(production: boolean): Eta {
  return new Eta({ views: path.resolve('views'), autoEscape: true, cache: production });
}
