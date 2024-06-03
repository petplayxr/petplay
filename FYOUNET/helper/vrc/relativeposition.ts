import { Tetrahedron3D } from "./tetrahedron.ts";
import { OscSubscriber } from "./getvrcpos.ts";

// osc params
const PetPlay1: string = "/avatar/parameters/PetPlayPole1"; // float out
const PetPlay2: string = "/avatar/parameters/PetPlayPole2"; // float out
const PetPlay3: string = "/avatar/parameters/PetPlayPole3"; // float out
const PetPlay4: string = "/avatar/parameters/PetPlayPole4"; // float out
const PetPlay5: string = "/avatar/parameters/PetPlayPole5"; // float out
const PetPlay6: string = "/avatar/parameters/PetPlayPole6"; // float out
const PetPlay7: string = "/avatar/parameters/PetPlayPole7"; // float out

export class RelativePositionService {
    private distances: { [key: string]: number } = {};
    private tetrahedron: Tetrahedron3D;
    private oscSubscriber: OscSubscriber;
    private subscribers: ((position: any) => void)[] = [];

    constructor() {
        this.tetrahedron = new Tetrahedron3D([
            [0.5, 0, 0], //PetPlay1 // right
            [0, 0.5, 0], //PetPlay2 // up
            [0, 0, 0.5], //PetPlay3 // forward
            [0, 0, 0], //PetPlay4 // origin
            [-0.5, 0, 0], //PetPlay5 // left
            [0, -0.5, 0], //PetPlay6 // down
            [0, 0, -0.5], //PetPlay7 // back
        ]);

        this.oscSubscriber = new OscSubscriber([PetPlay1, PetPlay2, PetPlay3, PetPlay4, PetPlay5, PetPlay6, PetPlay7]);
        this.oscSubscriber.subscribe(this.handleOscMessage.bind(this));
        this.oscSubscriber.listenForOscMessages().then(() => {
            console.log('Finished listening for OSC messages.');
        });
    }

    private handleOscMessage(address: string, value: number) {
        this.distances[address] = value;

        if (Object.keys(this.distances).length === 7) {
            const rigtDistance = this.distances[PetPlay1];
            const upDistance = this.distances[PetPlay2];
            const forwardDistance = this.distances[PetPlay3];
            const originDistance = this.distances[PetPlay4];
            const leftDistance = this.distances[PetPlay5];
            const downDistance = this.distances[PetPlay6];
            const backDistance = this.distances[PetPlay7];

            if (
                rigtDistance === 0 || upDistance === 0 || forwardDistance === 0 
                || originDistance === 0
                || leftDistance === 0 || downDistance === 0 || backDistance === 0
            ) {
                return;
            }

            const secondTetrahedron = this.tetrahedron.findSecondTetrahedron([
                rigtDistance,
                upDistance,
                forwardDistance,
                originDistance,
                leftDistance,
                downDistance,
                backDistance,
            ]);
            const result2 = secondTetrahedron;

            if (result2 !== undefined) {
                this.notifySubscribers(result2);
            } else {
                console.log("No valid position calculated.");
            }
        }
        else
        {
            return
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
