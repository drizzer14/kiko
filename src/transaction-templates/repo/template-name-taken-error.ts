// Its own file: a `*.repo.ts` holds no class (`kiko-repo-no-class`).
export class TemplateNameTakenError extends Error {
  constructor() {
    super('Another template already has this name');
    this.name = 'TemplateNameTakenError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, TemplateNameTakenError.prototype);
  }
}
