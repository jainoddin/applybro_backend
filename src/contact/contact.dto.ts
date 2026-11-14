import { Transform } from "class-transformer";
import { Equals, IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from "class-validator";
export const CONTACT_SUBJECTS = ["General question", "Account help", "Partnership", "Report an issue", "Billing question"] as const;
export class ContactDto {
  @Transform(({value})=>typeof value==="string"?value.trim():value)
  @IsString() @Length(2,100) name: string;
  @Transform(({value})=>typeof value==="string"?value.trim().toLowerCase():value)
  @IsEmail() @MaxLength(254) email: string;
  @IsIn(CONTACT_SUBJECTS) subject: string;
  @Transform(({value})=>typeof value==="string"?value.trim():value)
  @IsString() @Length(10,5000) message: string;
  @Equals(true, {message:"Please agree to having your message sent to our contact inbox."}) consent: boolean;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}
