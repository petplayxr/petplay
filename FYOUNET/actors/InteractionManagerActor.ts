// OverlayActor.ts
import { Actor, Address, SerializedState } from '../actorsystem/types.ts';
import { actorManager } from '../actorsystem/actorManager.ts';
import { ActorP2P } from '../actorsystem/actorP2P.ts';

type HMDMatrix = [
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
];

export class aInteractionManager extends ActorP2P<aInteractionManager> {
  private input: Address<aOVRInput>;
  private interactable: Address<SimpleOverlayActor>;

  constructor(
    actorname: string,
    publicIp: string,
    state?: SerializedState<Actor>,
  ) {
    super(actorname, publicIp, state);
    this.onStart(state);
  }

  override onStart(state?: SerializedState<Actor>) {
    console.log('InteractionManagerActor started');

    if (state) {
      const newstate = this.deserialize(state);
      this.state = newstate;
      console.log('actor state reloaded!');
    }
  }

  async interactionLoop(ctx: actorManager) {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 10)); // 100ms delay
      if (this.input && this.interactable) {
        let inputState = '';
        let overlayState = '';

        await ctx.command(this.input, 'h_getOVRData', (data1: string) => {
          inputState = data1;
        });

        await ctx.command(
          this.interactable,
          'h_getOVRData',
          (data2: string) => {
            overlayState = data2;
          },
        );

        if (inputState && overlayState) {
          const inputStateM = inputState.split('\n');
          const matrixI = []; // Initialize matrixI as an empty array

          // Extract and process the first element
          if (inputStateM.length > 6) {
            const row1 = inputStateM[6].split(' ').map(Number).filter((num) => !isNaN(num));
            matrixI.push(row1);
          }

          // Extract and process the second element
          if (inputStateM.length > 7) {
            const row2 = inputStateM[7].split(' ').map(Number).filter((num) => !isNaN(num));
            matrixI.push(row2);
          }

          // Extract and process the third element
          if (inputStateM.length > 8) {
            const row3 = inputStateM[8].split(' ').map(Number).filter((num) => !isNaN(num));
            matrixI.push(row3);
          }
/*           console.log(matrixI); */

          const overlayStateM = overlayState.split(' ').map(Number);
          const matrix = [
            [
              overlayStateM[0],
              matrixI[0][1],
              matrixI[0][2],
              matrixI[0][3],
            ],
            [
              matrixI[1][0],
              overlayStateM[5],
              matrixI[1][2],
              matrixI[1][3],
            ],
            [
              matrixI[2][0],
              matrixI[2][1],
              overlayStateM[10],
              matrixI[2][3],
            ],
          ];

          const finalMtrx = [
            matrix[0][0],
            matrix[0][1],
            matrix[0][2],
            matrix[0][3],
            matrix[1][0],
            matrix[1][1],
            matrix[1][2],
            matrix[1][3],
            matrix[2][0],
            matrix[2][1],
            matrix[2][2],
            matrix[2][3],
          ];

          const command = `SetOverlayPosition;${finalMtrx.join(' ')}`;

          ctx.command(this.interactable, 'h_commandOverlay', command);
          ctx.command(this.interactable, 'h_setOverlayState', `${finalMtrx.join(' ')}`);
        } else {
          console.log('no inputState or overlayState');
        }

        /* await new Promise((resolve) => setTimeout(resolve, 10)); // 100ms delay */
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10)); // 100ms delay
        /* console.log('no input or interactable'); */
      }
    }
  }

  async h_start(ctx: actorManager) {
    this.interactionLoop(ctx);
  }

  async h_addInput(_ctx: actorManager, input: Address<ActorP2P>) {
    this.input = input;
  }

  async h_addInteractable(_ctx: actorManager, interactable: Address<ActorP2P>) {
    this.interactable = interactable;
  }

  async onStop() {
  }
}
