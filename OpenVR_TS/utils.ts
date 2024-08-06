export const typeMapping: Record<string, { ffi: Deno.NativeType | Deno.NativeVoidType | Deno.NativeStructType; deno: string; c: string }> = {
    "i8": { ffi: "i8", deno: "number", c: "char" },
    "u8": { ffi: "u8", deno: "number", c: "unsigned char" },
    "i16": { ffi: "i16", deno: "number", c: "short int" },
    "u16": { ffi: "u16", deno: "number", c: "unsigned short int" },
    "i32": { ffi: "i32", deno: "number", c: "int" },
    "u32": { ffi: "u32", deno: "number", c: "unsigned int" },
    "i64": { ffi: "i64", deno: "bigint", c: "long long int" },
    "u64": { ffi: "u64", deno: "bigint", c: "unsigned long long int" },
    "usize": { ffi: "usize", deno: "number | bigint", c: "size_t" },
    "isize": { ffi: "isize", deno: "number | bigint", c: "ssize_t" },
    "f32": { ffi: "f32", deno: "number", c: "float" },
    "f64": { ffi: "f64", deno: "number", c: "double" },
    "void": { ffi: "void", deno: "undefined", c: "void" },
    "pointer": { ffi: "pointer", deno: "Deno.PointerValue", c: "void*" },
    "buffer": { ffi: "buffer", deno: "Uint8Array", c: "uint8_t*" },
    "function": { ffi: "function", deno: "Function", c: "void (*)()" },
    // Adding the new types
    "bool": { ffi: "bool", deno: "boolean", c: "bool" },
    "uint32_t": { ffi: "u32", deno: "number", c: "uint32_t" },
    "uint64_t": { ffi: "u64", deno: "bigint", c: "uint64_t" },
    "int32_t": { ffi: "i32", deno: "number", c: "int32_t" },
    "const char *": { ffi: "pointer", deno: "string", c: "const char *" },
    "char *": { ffi: "pointer", deno: "string", c: "char *" },
    "char *const": { ffi: "pointer", deno: "string", c: "char *const" },
    "float": { ffi: "f32", deno: "number", c: "float" },
    "double": { ffi: "f64", deno: "number", c: "double" }
};

export function stringToPointer(str: string): Deno.PointerValue {
    const encoder = new TextEncoder();
    const view = encoder.encode(str + '\0');
    return Deno.UnsafePointer.of(view);
}

export enum FFIType {
    BOOL = 'bool',
    I8 = 'i8',
    U8 = 'u8',
    I16 = 'i16',
    U16 = 'u16',
    I32 = 'i32',
    U32 = 'u32',
    I64 = 'i64',
    U64 = 'u64',
    F32 = 'f32',
    F64 = 'f64',
    POINTER = 'pointer',
    // Add any other FFI types you need
  }


export function fillBuffer(view: DataView, data: any, offset = 0): number {
    const template = data
    for (const [key, value] of Object.entries(template)) {
        if (typeof value === 'boolean') {
            view.setUint8(offset, data[key] ? 1 : 0);
            offset += 1;
        } else if (typeof value === 'number') {
            view.setFloat32(offset, data[key], true);
            offset += 4;
        } else if (typeof value === 'bigint') {
            view.setBigUint64(offset, data[key], true);
            offset += 8;
        } else if (Array.isArray(value)) {
            const flatData = data[key].flat(Infinity);
            for (let i = 0; i < flatData.length; i++) {
                view.setFloat32(offset, flatData[i], true);
                offset += 4;
            }
        } else if (typeof value === 'object') {
            offset = fillBuffer(view, data[key], offset);
        }
    }
    return offset;
}

export function readBufferStructured(view: DataView, template: any, offset = 0): [any, number] {
    const result: any = {};
    let lastFieldType: string | null = null;

    for (const [key, value] of Object.entries(template)) {
        // Align to 8 bytes after a boolean field
        if (lastFieldType === 'boolean') {
            offset = Math.ceil(offset / 8) * 8;
        }

        //console.log(`Processing key: ${key}, type: ${typeof value}, current offset: ${offset}`);

        if (typeof value === 'boolean') {
            result[key] = view.getUint8(offset) !== 0;
            offset += 1;
            lastFieldType = 'boolean';
        } else if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                result[key] = view.getInt32(offset, true);
            } else {
                result[key] = view.getFloat32(offset, true);
            }
            offset += 4;
            lastFieldType = 'number';
        } else if (typeof value === 'bigint') {
            result[key] = view.getBigUint64(offset, true);
            offset += 8;
            lastFieldType = 'bigint';
        } else if (Array.isArray(value)) {
            [result[key], offset] = readArrayStructured(view, value, offset);
            lastFieldType = 'array';
        } else if (typeof value === 'object') {
            result[key] = {};
            for (const [subKey, subValue] of Object.entries(value)) {
                if (subKey === 'm' || subKey === 'v') {
                    [result[key][subKey], offset] = subKey === 'm' ? readMatrix(view, subValue, offset) : readVector(view, subValue, offset);
                } else {
                    [result[key][subKey], offset] = readBufferStructured(view, { [subKey]: subValue }, offset);
                    result[key][subKey] = result[key][subKey][subKey];
                }
            }
            lastFieldType = 'object';
        } else {
            throw new Error(`Unknown type: ${typeof value} for key ${key}`);
        }

        //console.log(`Finished ${key}, new offset: ${offset}`);
    }
    return [result, offset];
}

function readMatrix(view: DataView, template: number[][], offset: number): [number[][], number] {
    const result = [];
    for (const row of template) {
        const rowData = [];
        for (let i = 0; i < row.length; i++) {
            rowData.push(view.getFloat32(offset, true));
            offset += 4;
        }
        result.push(rowData);
    }
    return [result, offset];
}

function readVector(view: DataView, template: number[], offset: number): [number[], number] {
    const result = [];
    for (let i = 0; i < template.length; i++) {
        result.push(view.getFloat32(offset, true));
        offset += 4;
    }
    return [result, offset];
}
function readArrayStructured(view: DataView, template: any[], offset: number): [any, number] {
    const result = [];
    for (const item of template) {
        if (typeof item === 'number') {
            result.push(view.getFloat32(offset, true));
            offset += 4;
        } else if (Array.isArray(item)) {
            const [subArray, newOffset] = readArrayStructured(view, item, offset);
            result.push(subArray);
            offset = newOffset;
        } else if (typeof item === 'object') {
            const [subObject, newOffset] = readBufferStructured(view, item, offset);
            result.push(subObject);
            offset = newOffset;
        }
    }
    return [result, offset];
}


export function mapOpenVRTypeToDeno(type: string): string {
    // Remove 'vr::' prefix if present
    const cleanType = type.replace('vr::', '');

    // Check if it's a pointer type
    if (cleanType.endsWith('*')) {
        return 'Deno.PointerValue';
    }

    // Check if it's an enum type
    if (cleanType.startsWith('enum ')) {
        return 'number';
    }

    // Check if it's a struct type
    if (cleanType.startsWith('struct ')) {
        return cleanType.replace('struct ', '');
    }

    // Map C types to Deno types
    for (const [key, value] of Object.entries(typeMapping)) {
        if (value.c === cleanType) {
            return value.deno;
        }
    }

    // If no match found, return the original type
    return type;
}

export type OpenVRType = {
    classname?: string;
    methodname?: string;
    returntype?: string;
    params?: Array<{ paramname: string; paramtype: string }>;
    enumname?: string;
    values?: Array<{ name: string; value: string }>;
    typedef?: string;
    type?: string;
    struct?: string;
    fields?: Array<{ fieldname: string; fieldtype: string }>;
};


//#region stuff
/* export function generateOpenVRBindings(functions: typeof openVRFunctions) {
    let output = `// Auto-generated OpenVR bindings for Deno
  
  const lib = Deno.dlopen("openvr_api.dll", {
  `;

    // Generate symbol definitions
    for (const [funcName, funcDef] of Object.entries(functions)) {
        const paramTypes = funcDef.parameters.map(param => `"${typeMapping[param.type].ffi}"`).join(', ');
        const resultType = `"${typeMapping[funcDef.result].ffi}"`;
        output += `  ${funcName}: { parameters: [${paramTypes}], result: ${resultType} },\n`;
    }

    output += `});\n\n`;

    // Generate TypeScript function declarations
    for (const [funcName, funcDef] of Object.entries(functions)) {
        const params = funcDef.parameters.map(param =>
            `${param.name}: ${typeMapping[param.type].deno}`
        ).join(', ');
        let returnType = typeMapping[funcDef.result].deno;

        output += `export function ${funcName}(${params}): ${returnType} {\n`;
        output += `  return lib.symbols.${funcName}(${funcDef.parameters.map(p => p.name).join(', ')}) as ${returnType};\n`;
        output += `}\n\n`;
    }

    return output;
}

enum EVRInitError {
    None = 0,
    // ... other error codes
}
enum EVRApplicationType {
    Other = 0,
    // ... other application types
}
type InterfaceVersionStringPointer = Deno.PointerObject<string>;
type EVRInitErrorPointer = Deno.PointerObject<EVRInitError>;

const symbols = {
    VR_InitInternal: {
        parameters: ["pointer", "i32"] as [EVRInitErrorPointer, EVRApplicationType],
        result: "pointer" as Deno.PointerValue<unknown>,
    },
    VR_ShutdownInternal: {
        parameters: [] as [],
        result: "void",
    },
    VR_IsHmdPresent: {
        parameters: [] as [],
        result: "bool",
    },
    VR_GetGenericInterface: {
        parameters: ["pointer", "pointer"] as [InterfaceVersionStringPointer, EVRInitErrorPointer],
        result: "pointer" as PointerValue<unknown>, // intptr_t return type
    },
    VR_IsRuntimeInstalled: {
        parameters: [] as [],
        result: "bool",
    },
    VR_GetVRInitErrorAsSymbol: {
        parameters: ["i32"] as [EVRInitError],
        result: "pointer" as PointerValue<string>, // char* return type
    },
    VR_GetVRInitErrorAsEnglishDescription: {
        parameters: ["i32"] as [EVRInitError],
        result: "pointer" as PointerValue<string>, // char* return type
    },
};


const dylib = Deno.dlopen("openvr_api.dll", symbols); */
//#endregion