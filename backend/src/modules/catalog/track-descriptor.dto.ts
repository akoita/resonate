import { ArrayMaxSize, IsArray, IsIn, IsString, MaxLength } from "class-validator";
import {
  FAMILY_IDS,
  MAX_SUB_GENRE_LENGTH,
  MAX_SUB_GENRES,
} from "../descriptors/track_descriptor";

/**
 * Body of `PUT /catalog/releases/:releaseId/tracks/:trackId/descriptor`
 * (#2292): the COMPLETE new set of a track's genre families and sub-genres.
 * Families must be ids of the genre family vocabulary. Sub-genre labels are
 * checked against the vocabulary (or the labels already on the track) by the
 * service, after it has authorized the caller. Tempo, energy and vocal bands
 * are measured and cannot be sent.
 */
export class UpdateTrackDescriptorDto {
  @IsArray()
  @ArrayMaxSize(FAMILY_IDS.length)
  @IsIn(FAMILY_IDS, { each: true })
  families!: string[];

  @IsArray()
  @ArrayMaxSize(MAX_SUB_GENRES)
  @IsString({ each: true })
  @MaxLength(MAX_SUB_GENRE_LENGTH, { each: true })
  subGenres!: string[];
}
