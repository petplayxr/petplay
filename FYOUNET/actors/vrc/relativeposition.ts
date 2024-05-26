import { Tetrahedron3D } from "./tetrahedron.ts";
import { OscSubscriber } from './getvrcpos.ts';

// osc params
const PetPlay1: string = "/avatar/parameters/PetPlayPole1"; // float out
const PetPlay2: string = "/avatar/parameters/PetPlayPole2"; // float out
const PetPlay3: string = "/avatar/parameters/PetPlayPole3"; // float out
const PetPlay4: string = "/avatar/parameters/PetPlayPole4"; // float out

export class RelativePositionService {
    private distances: { [key: string]: number } = {};
    private tetrahedron: Tetrahedron3D;
    private oscSubscriber: OscSubscriber;
    private subscribers: ((position: any) => void)[] = [];

    constructor() {
        this.tetrahedron = new Tetrahedron3D([
            [0.3, 0, 0],
            [0, 0.3, 0],
            [0, 0, 0.3],
            [0, 0, 0]
        ]);

        this.oscSubscriber = new OscSubscriber([PetPlay1, PetPlay2, PetPlay3, PetPlay4]);
        this.oscSubscriber.subscribe(this.handleOscMessage.bind(this));
        this.oscSubscriber.listenForOscMessages().then(() => {
            console.log('Finished listening for OSC messages.');
        });
    }

    private handleOscMessage(address: string, value: number) {
        this.distances[address] = value;

        if (Object.keys(this.distances).length === 4) {
            const redDistance = this.distances[PetPlay1];
            const blueDistance = this.distances[PetPlay2];
            const greenDistance = this.distances[PetPlay3];
            const whiteDistance = this.distances[PetPlay4];

            const secondTetrahedron = this.tetrahedron.findSecondTetrahedron([redDistance, blueDistance, greenDistance, whiteDistance]);
            const result2 = secondTetrahedron;

            if (result2 !== undefined) {
                
                this.notifySubscribers(result2);
            } else {
                console.log("No valid position calculated.");
            }
        }
    }

    private notifySubscribers(position: any) {
        for (const subscriber of this.subscribers) {
            subscriber(position);
        }
    }

    public subscribe(subscriber: (position: any) => void) {
        this.subscribers.push(subscriber);
    }
}

