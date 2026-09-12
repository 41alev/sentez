// Bilinçli olarak gevşek (permissive) bir tip beyanı.
//
// `@types/better-sqlite3`'ün resmi tipleri `.get()`/`.all()` için `unknown`
// döndürür — bu, ham SQL üzerine kurulu bir kod tabanında her sorgu için
// ayrı bir satır şekli (row shape) tanımlamayı zorunlu kılar ki bu, gerçek
// hataların çıktığı yer olan "fonksiyonların girdi/çıktı sözleşmesi"
// katmanına göre orantısız bir efor olurdu (bkz. `server/lib/core.js` ve
// `server/services/*.js` içindeki JSDoc tipleri — asıl güvenlik ağı orada).
// Bu proje SQL sonuçlarını `any` olarak ele alır; asıl tip denetimi, bu
// sonuçları tüketen fonksiyonların dokümante edilmiş dönüş tiplerinde
// yapılır.
declare module 'better-sqlite3' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): RunResult;
    iterate(...params: any[]): IterableIterator<any>;
    pluck(toggle?: boolean): this;
    expand(toggle?: boolean): this;
    raw(toggle?: boolean): this;
    columns(): any[];
    bind(...params: any[]): this;
  }

  interface Transaction {
    (...args: any[]): any;
    default: Transaction;
    deferred: Transaction;
    immediate: Transaction;
    exclusive: Transaction;
  }

  interface DatabaseOptions {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (message?: any, ...args: any[]) => void;
  }

  class Database {
    constructor(filename?: string, options?: DatabaseOptions);
    prepare(sql: string): Statement;
    transaction(fn: (...args: any[]) => any): Transaction;
    exec(sql: string): this;
    pragma(pragma: string, options?: any): any;
    backup(destination: string, options?: any): Promise<any>;
    close(): this;
    readonly open: boolean;
    readonly name: string;
    readonly memory: boolean;
    readonly readonly: boolean;
    readonly inTransaction: boolean;
  }

  export = Database;
}
