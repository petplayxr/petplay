import { PostalService } from "./actorsystem/PostalService.ts";
import "./actors/main.ts";
import "./actors/subactor.ts";
import "./actors/signalingDenoServer.ts";

const postalservice = new PostalService();

const mainAddress = await postalservice.add("signalingDenoServer.ts");


