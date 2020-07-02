import Component from '@glimmer/component';
import {formatPostTime} from 'ghost-admin/helpers/gh-format-post-time';
import {inject as service} from '@ember/service';

export default class GhPostsListItemComponent extends Component {
    @service session;
    @service settings;
    @service intl;

    get authorNames() {
        return this.args.post.authors.map(author => author.name || author.email).join(', ');
    }

    get scheduledText() {
        let {post} = this.args;
        let text = [];

        if (post.sendEmailWhenPublished) {
            let paid = post.visibility === 'paid';
            text.push(paid
                ? this.intl.t('and sent to paid members')
                : this.intl.t('and sent to all members')
            );
        }

        let formattedTime = formatPostTime(
            post.publishedAtUTC,
            {timezone: this.settings.get('timezone'), scheduled: true}
        );
        text.push(formattedTime);

        return text.join(' ');
    }
}
