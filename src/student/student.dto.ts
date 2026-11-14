import { IsEmail, IsString, MinLength, MaxLength, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class StudentSubmissionDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) fullName: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) nameOnId: string;
  @Transform(trim) @IsEmail() @MaxLength(200) email: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(150) institution: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) studentId: string;
}
export class StudentReviewDto {
  @IsIn(['APPROVED', 'REJECTED']) status: string;
  @Transform(trim) @IsString() @MaxLength(500) reason: string;
  @Transform(trim) @IsString() @MaxLength(100) documentName: string;
}
export class StudentAdminLoginDto {
  @IsString() @MinLength(12) @MaxLength(200) key: string;
}
