import { Message } from "https://deno.land/x/osc@v0.1.0/mod.ts";

const PetPlay1 : string = "/avatar/parameters/PetPlay1";                     //float out
const PetPlay2 : string = "/avatar/parameters/PetPlay2";                     //float out
const PetPlay3 : string = "/avatar/parameters/PetPlay3";                     //float out
const PetPlay4 : string = "/avatar/parameters/PetPlay9";                     //float out

const values = {
  [PetPlay1]: 0,
  [PetPlay2]: 0,
  [PetPlay3]: 0,
  [PetPlay4]: 0,
};

async function clearLine() {
  await Deno.stdout.write(new TextEncoder().encode("\x1b[1A\r\x1b[K"));
  await Deno.stdout.write(new TextEncoder().encode("\x1b[1A\r\x1b[K"));
  await Deno.stdout.write(new TextEncoder().encode("\x1b[1A\r\x1b[K"));
  await Deno.stdout.write(new TextEncoder().encode("\x1b[1A\r\x1b[K"));
}

async function displayValues() {
  await clearLine();

  await Deno.stdout.write(new TextEncoder().encode(
    `${PetPlay1}: ${values[PetPlay1]}\n ${PetPlay2}: ${values[PetPlay2]}\n ${PetPlay3}: ${values[PetPlay3]}\n ${PetPlay4}: ${values[PetPlay4]}\n`
  ));
}

async function listenForOscMessages(...addresses: string[]) {
  const conn = Deno.listenDatagram({ port: 9001, transport: "udp" });
  const addressSet = new Set(addresses);

  // Print initial empty values to set up the console line
  await displayValues();

  for await (const [buffer, _addr] of conn) {
    const msg = await Message.fromBuffer(buffer);
    const msgWithAddress = msg as { addr: string; args: number[] };

    if (addressSet.has(msgWithAddress.addr)) {
      values[msgWithAddress.addr] = msgWithAddress.args[0];
      await displayValues();
    }
  }

  conn.close();
}

listenForOscMessages(PetPlay1, PetPlay2, PetPlay3, PetPlay4).then(() => {
  console.log('Finished listening for OSC messages.');
});