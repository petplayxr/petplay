import { MessageAddressReal } from "../actorsystem/types.ts";
import { Postman } from "./PostMan.ts";

export type CoordState = {
  id: string;
};

export function getId(address: any, id: string) {
  // use a check here
  const addr = address as MessageAddressReal;
  Postman.PostMessage({
    address: { fm: id, to: addr.fm },
    type: "CB:GETID",
    payload: id,
  }, false);
}
