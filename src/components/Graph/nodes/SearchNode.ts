import { ClassicPreset } from 'rete';
import { eventSocket } from './types';
import { TextInputControl, CheckboxControl } from './controls';

export class SearchNode extends ClassicPreset.Node {
  width = 200;
  height = 160;

  private keyword: string = '';
  private useRegex: boolean = false;

  constructor() {
    super('Search');

    this.addInput('input', new ClassicPreset.Input(eventSocket, 'Input'));
    this.addOutput('output', new ClassicPreset.Output(eventSocket, 'Output'));

    this.addControl(
      'keyword',
      new TextInputControl(
        this.keyword,
        'Keyword',
        (value) => {
          this.keyword = value;
        }
      )
    );

    this.addControl(
      'regex',
      new CheckboxControl(
        this.useRegex,
        'Use Regex',
        (checked) => {
          this.useRegex = checked;
        }
      )
    );
  }

  getKeyword(): string {
    return this.keyword;
  }

  isRegex(): boolean {
    return this.useRegex;
  }

  matches(content: string): boolean {
    if (!this.keyword) return true;

    if (this.useRegex) {
      try {
        const regex = new RegExp(this.keyword, 'i');
        return regex.test(content);
      } catch {
        return false;
      }
    }

    return content.toLowerCase().includes(this.keyword.toLowerCase());
  }

  serialize() {
    return {
      keyword: this.keyword,
      useRegex: this.useRegex,
    };
  }

  deserialize(data: { keyword: string; useRegex: boolean }) {
    this.keyword = data.keyword;
    this.useRegex = data.useRegex;

    const keywordControl = this.controls['keyword'] as TextInputControl;
    if (keywordControl) {
      keywordControl.value = this.keyword;
    }

    const regexControl = this.controls['regex'] as CheckboxControl;
    if (regexControl) {
      regexControl.checked = this.useRegex;
    }
  }
}
