import { Entity } from "typeorm";

@Entity({ schema: 'havit', name: 'users' })
export class RoutineExercise {
  exercise: any;
  routine: any;
}
