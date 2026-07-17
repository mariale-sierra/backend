import { Entity, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Challenge } from './challenge.entity';
import { ExerciseLocation } from '../../exercises/entities/exercise-location.entity';

@Entity({ schema: 'havit', name: 'challenge_location_map' })
export class ChallengeLocationMap {
  @PrimaryColumn({ name: 'challenge_id', type: 'uuid' })
  challengeId!: string;

  @PrimaryColumn({ name: 'location_id' })
  locationId!: number;

  @ManyToOne(() => Challenge, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challenge_id' })
  challenge!: Challenge;

  @ManyToOne(() => ExerciseLocation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'location_id' })
  location!: ExerciseLocation;
}
