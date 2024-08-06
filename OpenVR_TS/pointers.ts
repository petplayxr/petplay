

export class P {
    static Int8P<T>(): Deno.PointerObject<T> {
        return Deno.UnsafePointer.of<T>(new Int8Array(1))!;
    }
    static Uint8P<T>(): Deno.PointerObject<T> {
        return Deno.UnsafePointer.of<T>(new Uint8Array(1))!;
    }
    static Int16P<T>(): Deno.PointerObject<T> {
        return Deno.UnsafePointer.of<T>(new Int16Array(1))!;
    }
    static Uint16P<T>(): Deno.PointerObject<T> {
        return Deno.UnsafePointer.of<T>(new Uint16Array(1))!;
    }
    static Int32P<T>(): Deno.PointerObject<T> {
        return Deno.UnsafePointer.of<T>(new Int32Array(1))!;
    }
    static Uint32P<T>(): Deno.PointerObject<T> {
        return Deno.UnsafePointer.of<T>(new Uint32Array(1))!;
    }
    static BigInt64P<T>(): Deno.PointerObject<T> {
        return Deno.UnsafePointer.of<T>(new BigInt64Array(1))!;
    }
    static BigUint64P<T>(): Deno.PointerObject<T> {
        return Deno.UnsafePointer.of<T>(new BigUint64Array(1))!;
    }
    static Float32P<T>(): Deno.PointerObject<T> {
        return Deno.UnsafePointer.of<T>(new Float32Array(1))!;
    }
    static Float64P<T>(): Deno.PointerObject<T> {
        return Deno.UnsafePointer.of<T>(new Float64Array(1))!;
    }



    // Add more as needed
}