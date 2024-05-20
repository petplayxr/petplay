import { Message } from "https://deno.land/x/osc@v0.1.0/mod.ts";

const PetPlay1: string = "/avatar/parameters/PetPlay1"; //float out
const PetPlay2: string = "/avatar/parameters/PetPlay2"; //float out
const PetPlay3: string = "/avatar/parameters/PetPlay3"; //float out
const PetPlay4: string = "/avatar/parameters/PetPlay9"; //float out

type Callback = (address: string, value: number) => void;

class OscSubscriber {
  private values: { [key: string]: number } = {
    [PetPlay1]: 0,
    [PetPlay2]: 0,
    [PetPlay3]: 0,
    [PetPlay4]: 0,
  };

  private subscribers: Callback[] = [];

  constructor(private addresses: string[]) {}

  public subscribe(callback: Callback) {
    this.subscribers.push(callback);
  }

  private async notifySubscribers(address: string, value: number) {
    for (const subscriber of this.subscribers) {
      subscriber(address, value);
    }
  }

  private async displayValues() {
    await Deno.stdout.write(new TextEncoder().encode(
      `${PetPlay1}: ${this.values[PetPlay1]}\n${PetPlay2}: ${this.values[PetPlay2]}\n${PetPlay3}: ${this.values[PetPlay3]}\n${PetPlay4}: ${this.values[PetPlay4]}\n`
    ));
  }

  public async listenForOscMessages() {
    const conn = Deno.listenDatagram({ port: 9001, transport: "udp" });
    const addressSet = new Set(this.addresses);

    // Print initial empty values to set up the console line
    await this.displayValues();

    for await (const [buffer, _addr] of conn) {
      const msg = await Message.fromBuffer(buffer);
      const msgWithAddress = msg as { addr: string; args: number[] };

      if (addressSet.has(msgWithAddress.addr)) {
        const newValue = msgWithAddress.args[0];
        this.values[msgWithAddress.addr] = newValue;
        await this.displayValues();
        await this.notifySubscribers(msgWithAddress.addr, newValue);
      }
    }

    conn.close();
  }
}

// Usage
const oscSubscriber = new OscSubscriber([PetPlay1, PetPlay2, PetPlay3, PetPlay4]);

// Subscribe to changes
oscSubscriber.subscribe((address, value) => {
  console.log(`Address ${address} updated to value ${value}`);
});

// Start listening for OSC messages
oscSubscriber.listenForOscMessages().then(() => {
  console.log('Finished listening for OSC messages.');
});
